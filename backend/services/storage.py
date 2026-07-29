"""In-memory store with optional JSON file persistence."""
from typing import Dict, Optional, Any
from models.schemas import (
    UserStory, CodebaseSync, GeneratedTest, ExecutionJob, GitHubConfigRequest
)
import hashlib, json, os, threading
from datetime import datetime

_lock = threading.Lock()

_store: Dict[str, Any] = {
    "stories": {},
    "codebase_syncs": {},
    "generated_tests": {},
    "generation_jobs": {},
    "execution_jobs": {},
    "scan_jobs": {},
    "scan_cache": {},
    "github_config": None,
    "development_artifacts": {},
    "activity_log": [],
}

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "store.json")


def init_storage():
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE) as f:
                saved = json.load(f)
                _store.update(saved)
                _store.setdefault("scan_cache", {})
                _mark_stale_execution_jobs_failed()
        except Exception:
            pass


def _mark_stale_execution_jobs_failed():
    changed = False
    now = datetime.utcnow().isoformat()
    for job in _store.get("execution_jobs", {}).values():
        if job.get("status") != "running":
            continue
        total = job.get("total") or len(job.get("test_ids", []))
        completed = len(job.get("results", []))
        job.update({
            "status": "failed",
            "completed_at": now,
            "total": total,
            "errors": max(job.get("errors", 0), max(total - completed, 1)),
        })
        changed = True
    if changed:
        _persist()


def _persist():
    try:
        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
        with open(DATA_FILE, "w") as f:
            json.dump(_store, f, default=str, indent=2)
    except Exception:
        pass


# Stories
def get_stories() -> Dict[str, dict]:
    return _store["stories"]

def save_story(story: UserStory):
    with _lock:
        _store["stories"][story.id] = story.model_dump()
        _add_activity("story_added", f"Story added: {story.title}", story.id)
        _persist()

def delete_story(story_id: str):
    with _lock:
        _store["stories"].pop(story_id, None)
        _persist()


# Codebase
def get_codebase_syncs() -> Dict[str, dict]:
    return _store["codebase_syncs"]

def save_codebase_sync(sync: CodebaseSync):
    with _lock:
        _store["codebase_syncs"][sync.id] = sync.model_dump()
        _persist()

def get_latest_codebase_sync() -> Optional[dict]:
    syncs = _store["codebase_syncs"]
    if not syncs:
        return None
    return sorted(syncs.values(), key=lambda x: x["created_at"], reverse=True)[0]


# Generated tests
def get_generated_tests() -> Dict[str, dict]:
    return _store["generated_tests"]

def save_generated_test(test: GeneratedTest):
    with _lock:
        _store["generated_tests"][test.id] = test.model_dump()
        _persist()

def update_test_status(test_id: str, status: str):
    with _lock:
        if test_id in _store["generated_tests"]:
            _store["generated_tests"][test_id]["status"] = status
            _persist()

def update_test(test_id: str, updates: dict):
    """Patch arbitrary fields on a GeneratedTest (edit before running)."""
    with _lock:
        if test_id in _store["generated_tests"]:
            _store["generated_tests"][test_id].update(
                {k: v for k, v in updates.items() if v is not None}
            )
            _persist()


# Generation jobs
def get_generation_jobs() -> Dict[str, dict]:
    return _store["generation_jobs"]

def save_generation_job(job_id: str, job_data: dict):
    with _lock:
        _store["generation_jobs"][job_id] = job_data
        _persist()

def update_generation_job(job_id: str, updates: dict):
    with _lock:
        if job_id in _store["generation_jobs"]:
            _store["generation_jobs"][job_id].update(updates)
            _persist()


# Development artifacts
def get_development_artifacts() -> Dict[str, dict]:
    return _store.setdefault("development_artifacts", {})

def save_development_artifact(job_id: str, artifact: dict):
    with _lock:
        _store.setdefault("development_artifacts", {})[job_id] = artifact
        _persist()

def update_development_artifact(job_id: str, updates: dict):
    with _lock:
        if job_id in _store.setdefault("development_artifacts", {}):
            _store["development_artifacts"][job_id].update(updates)
            _persist()


# Execution jobs
def get_execution_jobs() -> Dict[str, dict]:
    return _store["execution_jobs"]

def save_execution_job(job: ExecutionJob):
    with _lock:
        _store["execution_jobs"][job.id] = job.model_dump()
        _persist()

def update_execution_job(job_id: str, updates: dict):
    with _lock:
        if job_id in _store["execution_jobs"]:
            _store["execution_jobs"][job_id].update(updates)
            _persist()


# GitHub
def get_github_config() -> Optional[dict]:
    return _store["github_config"]

def save_github_config(config: dict):
    with _lock:
        _store["github_config"] = config
        _persist()


# Scan jobs
def get_scan_jobs() -> Dict[str, dict]:
    return _store.setdefault("scan_jobs", {})

def save_scan_job(job_id: str, job_data: dict):
    with _lock:
        _store.setdefault("scan_jobs", {})[job_id] = job_data
        _persist()

def update_scan_job(job_id: str, updates: dict):
    with _lock:
        if job_id in _store.get("scan_jobs", {}):
            _store["scan_jobs"][job_id].update(updates)
            _persist()


def make_scan_cache_key(source_type: str, path_or_url: str, branch: str = "", app_url: str = "", options: Optional[dict] = None) -> str:
    payload = {
        "source_type": (source_type or "").strip().lower(),
        "path_or_url": (path_or_url or "").strip().rstrip("/").lower(),
        "branch": (branch or "").strip(),
        "app_url": (app_url or "").strip().rstrip("/"),
        "options": options or {},
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_scan_cache(cache_key: str) -> Optional[dict]:
    return _store.setdefault("scan_cache", {}).get(cache_key)


def save_scan_cache(cache_key: str, cache_data: dict):
    with _lock:
        _store.setdefault("scan_cache", {})[cache_key] = cache_data
        _persist()


# Activity log
def _add_activity(event_type: str, message: str, ref_id: str = ""):
    from datetime import datetime
    _store["activity_log"].insert(0, {
        "type": event_type,
        "message": message,
        "ref_id": ref_id,
        "timestamp": datetime.utcnow().isoformat(),
    })
    _store["activity_log"] = _store["activity_log"][:50]

def get_activity_log():
    return _store["activity_log"]
