"""Fetch source files from a public GitHub repo via the GitHub API."""
import os
import re
import httpx
from typing import Dict, List

# File extensions we care about for analysis
INCLUDE_EXTS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css",
    ".json", ".yaml", ".yml", ".env.example", ".md",
}
# Paths to skip
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "__pycache__",
    ".venv", "venv", "coverage", ".nyc_output",
}
MAX_FILES = 60
MAX_FILE_BYTES = 40_000


def _parse_github_url(url: str):
    url = url.rstrip("/")
    m = re.match(r"https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", url)
    if not m:
        raise ValueError(f"Not a valid GitHub URL: {url}")
    return m.group(1), m.group(2)


def _headers():
    token = os.getenv("GITHUB_TOKEN", "")
    h = {"Accept": "application/vnd.github.v3+json"}
    if token:
        h["Authorization"] = f"token {token}"
    return h


def _trust_env_proxies() -> bool:
    """Avoid inherited sandbox/dead proxies unless explicitly requested."""
    return os.getenv("GITHUB_TRUST_ENV_PROXY", "").lower() in ("1", "true", "yes")


async def scan_github_repo(github_url: str, branch: str = "main") -> Dict:
    """Return a dict with repo metadata and file contents."""
    owner, repo = _parse_github_url(github_url)
    files: Dict[str, str] = {}
    errors: List[str] = []

    async with httpx.AsyncClient(timeout=30, verify=False, trust_env=_trust_env_proxies()) as client:
        # Try to get tree
        for ref in [branch, "main", "master"]:
            r = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1",
                headers=_headers(),
            )
            if r.status_code == 200:
                branch = ref
                tree = r.json().get("tree", [])
                break
        else:
            raise ValueError(f"Could not access repo {owner}/{repo}. Is it public?")

        # Filter relevant files
        candidates = [
            item for item in tree
            if item["type"] == "blob"
            and any(item["path"].endswith(ext) for ext in INCLUDE_EXTS)
            and not any(skip in item["path"].split("/") for skip in SKIP_DIRS)
        ][:MAX_FILES]

        # Fetch each file
        for item in candidates:
            try:
                r = await client.get(
                    f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{item['path']}",
                    headers=_headers(),
                )
                if r.status_code == 200:
                    content = r.text[:MAX_FILE_BYTES]
                    files[item["path"]] = content
            except Exception as e:
                errors.append(f"{item['path']}: {e}")

    return {
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "file_count": len(files),
        "files": files,
        "errors": errors,
    }
