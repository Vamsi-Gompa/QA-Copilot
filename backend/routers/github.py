from fastapi import APIRouter, HTTPException
from pathlib import Path
import json
import re
from models.schemas import GitHubConfigRequest, GitHubPushRequest, GitHubRepoPlanRequest
from services import storage
from services.github_service import GitHubService

router = APIRouter()


@router.post("/configure")
async def configure_github(body: GitHubConfigRequest):
    storage.save_github_config(body.model_dump())
    return {"configured": True, "repo": body.repo}


@router.get("/config")
async def get_config():
    cfg = storage.get_github_config()
    if not cfg:
        raise HTTPException(404, "GitHub not configured")
    # Mask token
    masked = dict(cfg)
    masked["token"] = masked["token"][:8] + "..." if masked.get("token") else ""
    return masked


@router.post("/repo-plan")
async def repo_plan(body: GitHubRepoPlanRequest):
    detected = _detect_repo_from_path_or_url(body.path_or_url or "")
    repo = (body.repo or detected.get("repo") or "").strip()
    suggested = _suggest_repo_name(body.path_or_url or repo)
    branches = detected.get("branches", [])
    repo_exists = False
    default_branch = detected.get("default_branch") or "main"

    token = body.token or (storage.get_github_config() or {}).get("token")
    if token and repo:
        try:
            svc = GitHubService(token, repo)
            repo_exists = await svc.repo_exists()
            if repo_exists:
                remote_branches = await svc.list_branches()
                if remote_branches:
                    branches = remote_branches
                default_branch = await svc.get_default_branch()
        except Exception:
            repo_exists = False

    if not repo and suggested:
        repo = suggested

    target_branch = body.branch or "feature/ai-developed-code"
    branch_choices = list(dict.fromkeys([target_branch, default_branch, *branches]))

    return {
        "source_path": body.path_or_url or "",
        "is_git_repo": bool(detected.get("is_git_repo")),
        "detected_repo": detected.get("repo") or "",
        "repo": repo,
        "suggested_repo_name": suggested,
        "repo_exists": repo_exists or bool(detected.get("repo")),
        "default_branch": default_branch,
        "branches": branch_choices,
        "target_branch": target_branch,
        "create_repo": not (repo_exists or detected.get("repo")),
        "message": (
            "Existing repository detected."
            if repo_exists or detected.get("repo")
            else f"No repository detected. Suggested new repository: {suggested or repo or 'qa-copilot-project'}."
        ),
    }


@router.post("/push")
async def push_tests(body: GitHubPushRequest):
    cfg = storage.get_github_config()
    if not cfg:
        raise HTTPException(400, "GitHub not configured. Call /api/github/configure first.")

    selected = []
    implementation_files = []
    if body.development_job_id:
        artifact = storage.get_development_artifacts().get(body.development_job_id)
        if artifact:
            implementation_files = artifact.get("files", [])
    if not implementation_files:
        raise HTTPException(400, "No implementation files found for this development job")

    svc = GitHubService(cfg["token"], cfg["repo"])
    try:
        result = await svc.push_tests(
            tests=selected,
            branch=cfg["branch"],
            commit_message=body.commit_message,
            create_pr=body.create_pr,
            pr_title=cfg.get("pr_title", "feat: Add AI-developed story implementation"),
            base_branch=cfg.get("base_branch", "main"),
            create_repo=bool(cfg.get("create_repo")),
            implementation_files=implementation_files,
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    return result


def _detect_repo_from_path_or_url(value: str) -> dict:
    value = (value or "").strip()
    if not value:
        return {"is_git_repo": False, "repo": "", "branches": [], "default_branch": "main"}

    parsed = _parse_github_repo(value)
    if parsed:
        return {"is_git_repo": True, "repo": parsed, "branches": [], "default_branch": "main"}

    path = Path(value).expanduser()
    git_dir = path / ".git"
    if not git_dir.exists():
        return {"is_git_repo": False, "repo": "", "branches": [], "default_branch": "main"}

    repo = ""
    config = git_dir / "config"
    if config.exists():
        try:
            text = config.read_text(encoding="utf-8", errors="ignore")
            match = re.search(r"url\s*=\s*(.+)", text)
            if match:
                repo = _parse_github_repo(match.group(1).strip()) or ""
        except Exception:
            pass

    default_branch = "main"
    head = git_dir / "HEAD"
    if head.exists():
        try:
            text = head.read_text(encoding="utf-8", errors="ignore").strip()
            if text.startswith("ref:"):
                default_branch = text.rsplit("/", 1)[-1] or "main"
        except Exception:
            pass

    branch_root = git_dir / "refs" / "heads"
    branches = []
    if branch_root.exists():
        branches = [
            str(item.relative_to(branch_root)).replace("\\", "/")
            for item in branch_root.rglob("*")
            if item.is_file()
        ]

    return {
        "is_git_repo": True,
        "repo": repo,
        "branches": branches,
        "default_branch": default_branch,
    }


def _parse_github_repo(value: str) -> str | None:
    value = value.strip()
    patterns = (
        r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?(?:[#?].*)?$",
        r"^([^/\s]+)/([^/\s]+)$",
    )
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            owner = match.group(1)
            repo = re.sub(r"\.git$", "", match.group(2))
            return f"{owner}/{repo}"
    return None


def _suggest_repo_name(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return "qa-copilot-project"
    parsed = _parse_github_repo(value)
    if parsed:
        return parsed
    name = Path(value).expanduser().name or value
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-._").lower()
    return slug or "qa-copilot-project"
