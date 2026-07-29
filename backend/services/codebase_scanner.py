"""Scan local or git codebase and extract structure for AI context."""
import os
import re
import tempfile
import shutil
from typing import Dict, List, Any, Optional
from pathlib import Path

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".nuxt", "coverage", ".pytest_cache"
}

CODE_EXTENSIONS = {
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".jsx": "React",
    ".html": "HTML",
    ".css": "CSS",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".java": "Java",
    ".go": "Go",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".cpp": "C++",
    ".rs": "Rust",
}

MAX_FILE_CONTENT_CHARS = 3000
MAX_FILE_CONTEXT_CHARS = 40_000
MAX_FILES_TO_SAMPLE = 20
MAX_CONTEXT_FILES = 80


def scan_local_path(path: str) -> Dict[str, Any]:
    """Scan a local directory and return structure + context."""
    if not os.path.exists(path):
        return {"error": f"Path not found: {path}"}

    result = {
        "root": path,
        "file_count": 0,
        "languages": [],
        "structure": [],
        "api_endpoints": [],
        "components": [],
        "sampled_files": [],
        "files": {},
        "module_summaries": [],
        "summary": "",
    }

    lang_counts: Dict[str, int] = {}
    files_sampled = 0
    files_for_context = 0

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        rel_root = os.path.relpath(root, path)

        for fname in files:
            ext = Path(fname).suffix.lower()
            if ext not in CODE_EXTENSIONS:
                continue

            result["file_count"] += 1
            lang = CODE_EXTENSIONS[ext]
            lang_counts[lang] = lang_counts.get(lang, 0) + 1

            rel_path = os.path.join(rel_root, fname).replace("\\", "/")
            result["structure"].append(rel_path)

            fpath = os.path.join(root, fname)
            if files_sampled < MAX_FILES_TO_SAMPLE or files_for_context < MAX_CONTEXT_FILES:
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read(MAX_FILE_CONTEXT_CHARS)
                    if files_for_context < MAX_CONTEXT_FILES:
                        result["files"][rel_path] = content
                        files_for_context += 1
                    result["module_summaries"].append(_summarize_file(rel_path, content, lang))
                    _extract_endpoints(content, rel_path, result)
                    if files_sampled >= MAX_FILES_TO_SAMPLE:
                        continue
                    result["sampled_files"].append({
                        "path": rel_path,
                        "language": lang,
                        "preview": content[:MAX_FILE_CONTENT_CHARS],
                    })
                    files_sampled += 1
                except Exception:
                    pass

    result["languages"] = sorted(lang_counts, key=lang_counts.get, reverse=True)
    result["structure"] = result["structure"][:100]
    result["summary"] = _build_summary(result, lang_counts)
    return result


def scan_git_repo(url: str, branch: str = "main") -> Dict[str, Any]:
    """Clone a git repo and scan it."""
    try:
        import git
        tmpdir = tempfile.mkdtemp(prefix="qa_copilot_")
        try:
            repo = git.Repo.clone_from(url, tmpdir, branch=branch, depth=1)
            result = scan_local_path(tmpdir)
            result["git_url"] = url
            result["branch"] = branch
            return result
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
    except ImportError:
        return {"error": "gitpython not installed. Run: pip install gitpython"}
    except Exception as e:
        return {"error": str(e)}


def _extract_endpoints(content: str, path: str, result: dict):
    """Extract API endpoints and UI components from source code."""
    # FastAPI / Flask routes
    for match in re.finditer(r'@(app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)', content):
        result["api_endpoints"].append({
            "method": match.group(2).upper(),
            "path": match.group(3),
            "file": path,
        })

    # Express routes
    for match in re.finditer(r'(app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)', content):
        result["api_endpoints"].append({
            "method": match.group(2).upper(),
            "path": match.group(3),
            "file": path,
        })

    # React components
    for match in re.finditer(r'(?:export\s+(?:default\s+)?(?:function|const)\s+)([A-Z][a-zA-Z0-9]+)', content):
        if path.endswith((".tsx", ".jsx")):
            result["components"].append({
                "name": match.group(1),
                "file": path,
            })


def _summarize_file(path: str, content: str, language: str) -> dict:
    """Return a compact per-module summary for the LLM prompt."""
    symbols: List[str] = []
    routes: List[str] = []

    for match in re.finditer(r'@(app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)', content):
        routes.append(f"{match.group(2).upper()} {match.group(3)}")
    for match in re.finditer(r'(app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)', content):
        routes.append(f"{match.group(2).upper()} {match.group(3)}")

    if path.endswith(".py"):
        symbols.extend(re.findall(r"^(?:async\s+)?(?:def|class)\s+(\w+)", content, flags=re.M)[:12])
    elif path.endswith((".js", ".jsx", ".ts", ".tsx")):
        for groups in re.findall(
            r"(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|"
            r"(?:export\s+)?(?:default\s+)?class\s+(\w+))",
            content,
        ):
            symbols.extend([item for item in groups if item])
        symbols = symbols[:12]

    features = []
    lower = f"{path}\n{content[:5000]}".lower()
    for name, pattern in {
        "registration": "register",
        "login": "login",
        "upload": "upload|multipart|file",
        "validation": "validat|schema|required|error",
        "profile": "profile|account",
    }.items():
        if re.search(pattern, lower):
            features.append(name)

    return {
        "path": path,
        "language": language,
        "lines": content.count("\n") + 1,
        "symbols": list(dict.fromkeys(symbols))[:12],
        "routes": list(dict.fromkeys(routes))[:12],
        "features": features,
    }


def _build_summary(result: dict, lang_counts: Dict[str, int]) -> str:
    parts = [f"Codebase with {result['file_count']} files."]
    if lang_counts:
        top = list(lang_counts.items())[:3]
        parts.append("Languages: " + ", ".join(f"{l} ({c})" for l, c in top))
    if result["api_endpoints"]:
        parts.append(f"Found {len(result['api_endpoints'])} API endpoints.")
    if result["components"]:
        parts.append(f"Found {len(result['components'])} React components.")
    if result.get("module_summaries"):
        key_modules = [
            m["path"] for m in result["module_summaries"]
            if any(f in m.get("features", []) for f in ("registration", "login", "validation", "upload"))
        ][:6]
        if key_modules:
            parts.append("Key modules: " + ", ".join(key_modules) + ".")
    return " ".join(parts)
