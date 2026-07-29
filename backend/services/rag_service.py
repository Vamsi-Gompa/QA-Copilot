"""
RAG (Retrieval-Augmented Generation) for intelligent code context selection.

Hybrid approach:
  PRIMARY  : TF-IDF with bigrams (scikit-learn, always available, zero downloads)
  OPTIONAL : sentence-transformers deep learning (better semantic search)

Instead of sending ALL source files to Gemini on every call (token-expensive),
we index them locally and retrieve only the TOP-K most relevant chunks per query,
cutting token usage by 60-80% while improving accuracy.
"""
import re
import numpy as np
from typing import Dict, List, Optional

# ── Optional deep-learning embeddings ────────────────────────────────────────
_USE_DL = False
_encoder = None
try:
    from sentence_transformers import SentenceTransformer
    _encoder = SentenceTransformer("all-MiniLM-L6-v2")
    _USE_DL = True
    print("[RAG] Deep-learning mode: sentence-transformers/all-MiniLM-L6-v2")
except Exception:
    print("[RAG] TF-IDF mode (install sentence-transformers for DL embeddings)")

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as _sk_cos

# ── Config ────────────────────────────────────────────────────────────────────
_CHUNK_LINES   = 80
_OVERLAP_LINES = 15
_MAX_CTX_CHARS = 45_000

_LANG_MAP = {
    ".py": "python",   ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".java": "java",
    ".go": "go",       ".rb": "ruby",        ".cs": "csharp",
    ".php": "php",     ".html": "html",      ".css": "css",
    ".json": "json",   ".yaml": "yaml",      ".toml": "toml",
}
_SKIP = (
    "node_modules", ".min.js", ".map", "dist/", "build/",
    "__pycache__", ".venv", "package-lock", "yarn.lock", ".git/",
    "coverage/", ".next/", ".nuxt/",
)


def _skip(path: str) -> bool:
    return any(p in path for p in _SKIP)


def _lang(path: str) -> str:
    return next((v for k, v in _LANG_MAP.items() if path.lower().endswith(k)), "text")


def _symbols(text: str, lang: str) -> List[str]:
    """Extract declared names (functions, classes, routes) for semantic richness."""
    if lang == "python":
        return re.findall(r"^(?:async\s+)?(?:def|class)\s+(\w+)", text, re.M)[:10]
    if lang in ("typescript", "javascript"):
        hits = re.findall(
            r"(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|"
            r"(?:export\s+)?(?:default\s+)?class\s+(\w+)|"
            r"app\.\w+\s*\(['\"]([^'\"]+)['\"]|router\.\w+\s*\(['\"]([^'\"]+)['\"])",
            text,
        )
        return [s for g in hits for s in g if s][:10]
    if lang == "java":
        return re.findall(r"(?:public|private|protected)\s+\S+\s+(\w+)\s*\(", text, re.M)[:10]
    return []


def _chunk_file(path: str, content: str) -> List[Dict]:
    lang  = _lang(path)
    lines = content.splitlines()
    if len(lines) <= _CHUNK_LINES:
        return [{"text": content, "path": path, "lang": lang,
                 "symbols": _symbols(content, lang), "cidx": 0}]
    chunks, step = [], _CHUNK_LINES - _OVERLAP_LINES
    for i, start in enumerate(range(0, len(lines), step)):
        text = "\n".join(lines[start: start + _CHUNK_LINES])
        chunks.append({"text": text, "path": path, "lang": lang,
                       "symbols": _symbols(text, lang), "cidx": i})
        if start + _CHUNK_LINES >= len(lines):
            break
    return chunks


def _enrich(c: Dict) -> str:
    syms = ", ".join(c["symbols"]) if c["symbols"] else ""
    return f"FILE:{c['path']} LANG:{c['lang']} SYMBOLS:{syms}\n{c['text']}"


class CodeRAG:
    """
    Index a codebase once; retrieve focused context for each LLM call.

        rag = CodeRAG()
        n   = rag.index({"src/app.py": "...", "routes/api.ts": "..."})
        ctx = rag.context("user login form validation", max_chars=40_000)
    """

    def __init__(self):
        self._chunks:   List[Dict]          = []
        self._texts:    List[str]           = []
        self._dl_embs:  Optional[np.ndarray] = None
        self._tfidf:    Optional[TfidfVectorizer] = None
        self._tfidf_mat = None
        self.ready  = False
        self.mode   = "uninitialized"

    # ── Indexing ──────────────────────────────────────────────────────────────

    def index(self, files: Dict[str, str]) -> int:
        """Index all source files. Returns number of chunks indexed."""
        self._chunks.clear(); self._texts.clear()

        for path, content in files.items():
            if _skip(path) or not content or len(content.strip()) < 20:
                continue
            for c in _chunk_file(path, content):
                self._chunks.append(c)
                self._texts.append(_enrich(c))

        if not self._texts:
            return 0

        if _USE_DL and _encoder:
            self._dl_embs = _encoder.encode(
                self._texts, batch_size=16,
                show_progress_bar=False, normalize_embeddings=True,
            )
            self.mode = "deep-learning (all-MiniLM-L6-v2)"
        else:
            self._tfidf = TfidfVectorizer(
                max_features=15_000, ngram_range=(1, 2),
                sublinear_tf=True, strip_accents="unicode",
            )
            self._tfidf_mat = self._tfidf.fit_transform(self._texts)
            self.mode = "tfidf (scikit-learn)"

        self.ready = True
        return len(self._chunks)

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def _scores(self, query: str) -> np.ndarray:
        if _USE_DL and _encoder and self._dl_embs is not None:
            q = _encoder.encode([query], normalize_embeddings=True)
            return (self._dl_embs @ q.T).flatten()
        qv = self._tfidf.transform([query])
        return _sk_cos(qv, self._tfidf_mat).flatten()

    def retrieve(self, query: str, top_k: int = 20) -> List[Dict]:
        """Return top-k most relevant code chunks for the query."""
        if not self.ready:
            return []
        scores = self._scores(query)
        idxs   = np.argsort(scores)[::-1]
        seen, results = set(), []
        for i in idxs:
            key = f"{self._chunks[i]['path']}::{self._chunks[i]['cidx']}"
            if key not in seen:
                seen.add(key)
                results.append({**self._chunks[i], "score": float(scores[i])})
            if len(results) >= top_k:
                break
        return results

    def context(self, query: str, max_chars: int = _MAX_CTX_CHARS, top_k: int = 25) -> str:
        """Build a focused, token-efficient context string for an LLM prompt."""
        chunks = self.retrieve(query, top_k=top_k)
        parts, total = [], 0
        for c in chunks:
            entry = f"\n=== {c['path']} (relevance={c['score']:.2f}) ===\n{c['text']}\n"
            if total + len(entry) > max_chars:
                break
            parts.append(entry); total += len(entry)
        return "".join(parts)

    def file_tree(self, files: Dict[str, str]) -> str:
        """Compact file tree (names + key symbols) for the initial describe_app prompt."""
        rows = []
        for path, content in sorted(files.items()):
            if _skip(path): continue
            lang  = _lang(path)
            syms  = _symbols(content[:3000], lang)
            s_str = f"  [{', '.join(syms[:6])}]" if syms else ""
            rows.append(f"  {path} ({lang}, {content.count(chr(10))} lines){s_str}")
        return "\n".join(rows)

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)
