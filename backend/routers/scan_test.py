"""
Scan & Test router — scan a GitHub codebase and generate + execute tests
against a locally running app instance.
"""
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import ScanTestConfig, ScanTestJob, JobStatus, AgentEvent, GeneratedTest
from services import storage
from services.execution_service import list_saved_screenshots
from services.github_scanner import scan_github_repo
from services.codebase_scanner import scan_local_path
from agents.code_analyzer import analyze_and_generate_stream

router = APIRouter()


def _cache_options(ui_count: int, backend_count: int, scenarios: list) -> dict:
    clean_scenarios = scenarios or []
    if isinstance(clean_scenarios, str):
        clean_scenarios = [s.strip() for s in clean_scenarios.splitlines() if s.strip()]
    ui = max(0, int(ui_count or 0))
    backend = max(0, int(backend_count or 0))
    if ui == 0 and backend == 0:
        ui, backend = 5, 5
    return {
        "ui_test_count": ui,
        "backend_test_count": backend,
        "custom_scenarios": clean_scenarios,
    }


def _tests_for_job(job_id: str) -> list[dict]:
    return [
        t for t in storage.get_generated_tests().values()
        if t.get("generation_job_id") == job_id
    ]


def _clone_cached_tests(job_id: str, cached_tests: list[dict]) -> list[dict]:
    existing = _tests_for_job(job_id)
    if existing:
        return existing

    cloned: list[dict] = []
    for raw in cached_tests or []:
        if not isinstance(raw, dict):
            continue
        data = dict(raw)
        data["id"] = str(uuid.uuid4())
        data["generation_job_id"] = job_id
        data["created_at"] = datetime.utcnow().isoformat()
        try:
            test = GeneratedTest(**data)
        except Exception:
            continue
        storage.save_generated_test(test)
        cloned.append(test.model_dump())
    return cloned


def _event(event_type: str, content: str, metadata: dict | None = None) -> str:
    ev = AgentEvent(type=event_type, content=content, metadata=metadata or {})
    return f"data: {ev.model_dump_json()}\n\n"


@router.post("/start")
async def start_scan(config: ScanTestConfig):
    """Fetch repo files and create a scan job; returns job_id to stream."""
    source_type = (config.source_type or "git").lower()
    path_or_url = (config.path_or_url or config.github_url or "").strip()
    if source_type not in ("git", "local"):
        raise HTTPException(400, "source_type must be 'git' or 'local'")
    if not path_or_url:
        raise HTTPException(400, "Provide a repository URL or local directory path")

    options = _cache_options(config.ui_test_count, config.backend_test_count, config.custom_scenarios)
    repo_cache_key = storage.make_scan_cache_key(source_type, path_or_url, config.branch)
    generation_cache_key = storage.make_scan_cache_key(
        source_type,
        path_or_url,
        config.branch,
        config.app_url,
        options,
    )
    cached_generation = storage.get_scan_cache(generation_cache_key)
    cached_repo = (
        cached_generation
        if cached_generation and cached_generation.get("repo_data")
        else storage.get_scan_cache(repo_cache_key)
    )
    cache_hit = bool(cached_generation and cached_generation.get("tests") and cached_generation.get("repo_data"))
    repo_cache_hit = bool(cached_repo and cached_repo.get("repo_data"))

    try:
        if repo_cache_hit:
            repo_data = cached_repo["repo_data"]
        elif source_type == "local":
            repo_data = scan_local_path(path_or_url)
            if "error" in repo_data:
                raise ValueError(repo_data["error"])
            repo_data["owner"] = "local"
            repo_data["repo"] = repo_data.get("root", path_or_url).replace("\\", "/").rstrip("/").split("/")[-1] or "codebase"
            repo_data["branch"] = config.branch or "local"
        else:
            repo_data = await scan_github_repo(path_or_url, config.branch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        label = "local scan" if source_type == "local" else "GitHub fetch"
        raise HTTPException(502, f"{label} error: {e}")

    if not repo_cache_hit:
        storage.save_scan_cache(repo_cache_key, {
            "kind": "repo_scan",
            "source_type": source_type,
            "path_or_url": path_or_url,
            "branch": repo_data.get("branch", config.branch),
            "repo_data": repo_data,
            "created_at": datetime.utcnow().isoformat(),
        })

    job_id = str(uuid.uuid4())
    job = ScanTestJob(
        id=job_id,
        github_url=path_or_url,
        source_type=source_type,
        branch=repo_data["branch"],
        app_url=config.app_url,
        status=JobStatus.RUNNING,
        file_count=repo_data["file_count"],
        repo_owner=repo_data["owner"],
        repo_name=repo_data["repo"],
        ui_test_count=options["ui_test_count"],
        backend_test_count=options["backend_test_count"],
        custom_scenarios=options["custom_scenarios"],
    )
    job_data = job.model_dump()
    job_data.update({
        "cache_key": generation_cache_key,
        "repo_cache_key": repo_cache_key,
        "cache_hit": cache_hit,
        "repo_cache_hit": repo_cache_hit,
    })
    storage.save_scan_job(job_id, job_data)
    # Store repo_data separately so the stream can use it
    storage.save_scan_job(f"repo_{job_id}", repo_data)

    return {
        "job_id": job_id,
        "repo": f"{repo_data['owner']}/{repo_data['repo']}",
        "branch": repo_data["branch"],
        "file_count": repo_data["file_count"],
        "cached": cache_hit,
        "repo_cached": repo_cache_hit,
    }


@router.get("/{job_id}/stream")
async def stream_analysis(job_id: str):
    """SSE stream — connect with EventSource for live agent events."""
    job = storage.get_scan_jobs().get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found")

    repo_data = storage.get_scan_jobs().get(f"repo_{job_id}")
    if not repo_data:
        raise HTTPException(404, "Repo data not found. Call /start first.")

    app_url = job.get("app_url", "http://localhost:3000")
    options = {
        "ui_test_count": job.get("ui_test_count", 3),
        "backend_test_count": job.get("backend_test_count", 5),
        "custom_scenarios": job.get("custom_scenarios", []),
    }

    async def event_stream():
        try:
            cache_key = job.get("cache_key", "")
            cached = storage.get_scan_cache(cache_key) if cache_key else None
            if cached and cached.get("tests") and cached.get("repo_data"):
                tests = _clone_cached_tests(job_id, cached.get("tests", []))
                storage.save_generation_job(job_id, {
                    "id": job_id,
                    "status": "completed",
                    "test_count": len(tests),
                    "source": "scan_cache",
                    "created_at": datetime.utcnow().isoformat(),
                })
                storage.update_scan_job(job_id, {
                    "status": "completed",
                    "test_count": len(tests),
                    "cache_hit": True,
                })
                yield _event(
                    "progress",
                    f"Loaded saved scan cache for {job.get('repo_owner')}/{job.get('repo_name')}. Claude was not called.",
                    {"cache_hit": True, "test_count": len(tests)},
                )
                for test in tests:
                    yield _event(
                        "test_generated",
                        f"Loaded cached test: **{test.get('name', 'unnamed_test')}**",
                        {
                            "test_id": test.get("id"),
                            "category": test.get("category"),
                            "priority": test.get("priority"),
                            "test_name": test.get("name"),
                            "test_type": test.get("test_type"),
                            "file_name": test.get("file_name"),
                            "cached": True,
                        },
                    )
                yield _event(
                    "complete",
                    f"Done. Loaded {len(tests)} saved tests from cache.",
                    {"test_count": len(tests), "job_id": job_id, "cache_hit": True},
                )
                return

            async for chunk in analyze_and_generate_stream(job_id, repo_data, app_url, options):
                yield chunk
            tests = _tests_for_job(job_id)
            if tests and cache_key:
                storage.save_scan_cache(cache_key, {
                    "kind": "generated_tests",
                    "source_type": job.get("source_type", "git"),
                    "path_or_url": job.get("github_url", ""),
                    "branch": job.get("branch", ""),
                    "app_url": app_url,
                    "options": options,
                    "repo_data": repo_data,
                    "tests": tests,
                    "created_at": datetime.utcnow().isoformat(),
                })
            storage.update_scan_job(job_id, {"status": "completed"})
        except Exception as e:
            ev = AgentEvent(type="error", content=str(e), metadata={})
            yield f"data: {ev.model_dump_json()}\n\n"
            storage.update_scan_job(job_id, {"status": "failed"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/list")
async def list_scan_jobs():
    """Return all scan jobs (not the raw repo_data blobs)."""
    return [
        v for k, v in storage.get_scan_jobs().items()
        if isinstance(v, dict) and "status" in v and not k.startswith("repo_")
    ]


@router.get("/jobs/{job_id}")
async def get_scan_job(job_id: str):
    job = storage.get_scan_jobs().get(job_id)
    if not job or not isinstance(job, dict) or "status" not in job:
        raise HTTPException(404, "Scan job not found")
    return job


@router.get("/screenshots/list")
async def list_screenshots():
    """Return saved UI test screenshots from backend/data/screenshots."""
    return list_saved_screenshots()


@router.get("/{job_id}/tests")
async def get_scan_tests(job_id: str):
    """Return all tests generated for a given scan job."""
    all_tests = storage.get_generated_tests()
    return [t for t in all_tests.values() if t.get("generation_job_id") == job_id]
