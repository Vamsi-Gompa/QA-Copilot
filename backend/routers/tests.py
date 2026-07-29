from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
import uuid
from datetime import datetime
from pathlib import Path
from models.schemas import (
    TestGenerationRequest, GeneratedTest, TestStatus, TestUpdateRequest
)
from services import storage
from services.codebase_scanner import scan_git_repo, scan_local_path
from agents.test_generator import generate_tests_stream

router = APIRouter()


_TEST_DEFAULTS = {
    "category": "backend",
    "priority": "medium",
    "tags": [],
    "source_files": [],
    "editable_data": {},
    "expected_results": [],
    "file_name": "",
    "status": "generated",
}

@router.get("/", response_model=List[dict])
async def list_tests():
    return [{**_TEST_DEFAULTS, **t} for t in storage.get_generated_tests().values()]


@router.get("/{test_id}", response_model=dict)
async def get_test(test_id: str):
    tests = storage.get_generated_tests()
    if test_id not in tests:
        raise HTTPException(404, "Test not found")
    return {**_TEST_DEFAULTS, **tests[test_id]}


@router.put("/{test_id}/status")
async def update_test_status(test_id: str, status: str):
    if status not in (s.value for s in TestStatus):
        raise HTTPException(400, f"Invalid status: {status}")
    tests = storage.get_generated_tests()
    if test_id not in tests:
        raise HTTPException(404, "Test not found")
    storage.update_test_status(test_id, status)
    return {"test_id": test_id, "status": status}


@router.patch("/{test_id}")
async def patch_test(test_id: str, body: TestUpdateRequest):
    """Edit test content and metadata before running."""
    tests = storage.get_generated_tests()
    if test_id not in tests:
        raise HTTPException(404, "Test not found")
    updates = body.model_dump(exclude_none=True)
    storage.update_test(test_id, updates)
    return {**tests[test_id], **updates}


@router.post("/generate")
async def start_generation(body: TestGenerationRequest):
    stories_map = storage.get_stories()
    feature = body.custom_feature or {}
    feature_requested = bool(feature.get("title") or feature.get("description"))
    if body.story_ids:
        stories = [s for sid, s in stories_map.items() if sid in body.story_ids]
    elif feature_requested:
        stories = []
    else:
        stories = list(stories_map.values())

    if feature.get("title") and feature.get("description"):
        criteria = feature.get("acceptance_criteria") or []
        if isinstance(criteria, str):
            criteria = [line.strip() for line in criteria.splitlines() if line.strip()]
        stories.append({
            "id": f"custom-feature-{uuid.uuid4()}",
            "project_name": feature.get("project_name") or "Existing repository",
            "title": str(feature["title"]).strip(),
            "description": str(feature["description"]).strip(),
            "acceptance_criteria": criteria,
            "priority": feature.get("priority") or "high",
            "status": "ready",
            "references": [body.path_or_url or body.github_url or ""],
        })

    if not stories:
        raise HTTPException(400, "Select a user story or describe a custom feature to develop.")

    job_id = str(uuid.uuid4())
    options = body.model_dump()
    options["path_or_url"] = body.path_or_url or body.github_url or ""
    codebase_context = _resolve_codebase_context(body)
    if codebase_context:
        storage.save_generation_job(f"codebase_context_{job_id}", codebase_context)

    storage.save_generation_job(job_id, {
        "id": job_id,
        "status": "running",
        "story_ids": [s["id"] for s in stories],
        "stories": stories,
        "test_count": 0,
        "options": options,
        "development_job_id": job_id if body.develop_code else None,
    })
    return {"job_id": job_id, "story_count": len(stories), "development_job_id": job_id if body.develop_code else None}


def _resolve_codebase_context(body: TestGenerationRequest) -> dict:
    source_type = (body.source_type or "synced").lower()
    path_or_url = (body.path_or_url or body.github_url or "").strip()

    if source_type == "synced":
        latest_sync = storage.get_latest_codebase_sync()
        if not latest_sync:
            return {}
        ctx_key = f"codebase_context_{latest_sync['id']}"
        return storage.get_generation_jobs().get(ctx_key, {})

    if not path_or_url:
        raise HTTPException(400, "Choose a codebase source and provide a local path or GitHub URL.")

    if source_type == "local":
        result = scan_local_path(path_or_url)
    elif source_type == "git":
        result = scan_git_repo(path_or_url, body.branch or "main")
    else:
        raise HTTPException(400, "source_type must be 'synced', 'local', or 'git'")

    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.post("/export-local")
async def export_tests_local(test_ids: List[str] = Body(default=[])):
    """Write selected generated tests to backend/data/exports for local handoff."""
    tests_map = storage.get_generated_tests()
    if test_ids:
        selected = [tests_map[tid] for tid in test_ids if tid in tests_map]
    else:
        selected = [t for t in tests_map.values() if t.get("status") in ("approved", "generated")]

    if not selected:
        raise HTTPException(400, "No tests to export")

    export_root = (
        Path(__file__).resolve().parent.parent
        / "data"
        / "exports"
        / datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    )
    written = []

    for test in selected:
        file_name = test.get("file_name") or f"tests/{test.get('test_type', 'pytest')}/{test.get('name', test['id'])}.py"
        raw_parts = Path(file_name.replace("\\", "/")).parts
        safe_parts = [
            part for part in raw_parts
            if part not in ("", ".", "..") and not part.endswith(":")
        ]
        if not safe_parts:
            safe_parts = [f"{test['id']}.py"]
        out_path = export_root.joinpath(*safe_parts)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(test.get("code", ""), encoding="utf-8")
        written.append(str(out_path))

    return {"export_dir": str(export_root), "files": written}


@router.post("/export-package")
async def export_package(body: dict = Body(default={})):
    """Export implementation draft (if any) and selected tests to backend/data/exports."""
    job_id = body.get("job_id")
    test_ids = body.get("test_ids") or []
    tests_map = storage.get_generated_tests()
    selected = [tests_map[tid] for tid in test_ids if tid in tests_map] if test_ids else [
        t for t in tests_map.values() if not job_id or t.get("generation_job_id") == job_id
    ]
    artifact = storage.get_development_artifacts().get(job_id) if job_id else None

    if not selected and not artifact:
        raise HTTPException(400, "Nothing to export")

    export_root = (
        Path(__file__).resolve().parent.parent
        / "data"
        / "exports"
        / datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    )
    written = []

    if artifact:
        for item in artifact.get("files", []):
            out_path = _safe_join(export_root / "implementation", item.get("path") or "file.txt")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(item.get("content", ""), encoding="utf-8")
            written.append(str(out_path))

    for test in selected:
        file_name = test.get("file_name") or f"tests/{test.get('test_type', 'pytest')}/{test.get('name', test['id'])}.py"
        out_path = _safe_join(export_root, file_name)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(test.get("code", ""), encoding="utf-8")
        written.append(str(out_path))

    return {"export_dir": str(export_root), "files": written}


@router.get("/development/{job_id}")
async def get_development_artifact(job_id: str):
    artifact = storage.get_development_artifacts().get(job_id)
    if not artifact:
        raise HTTPException(404, "No development artifact found for this job")
    return artifact


@router.post("/development/{job_id}/save-local")
async def save_development_local(job_id: str, body: dict = Body(default={})):
    artifact = storage.get_development_artifacts().get(job_id)
    if not artifact:
        raise HTTPException(404, "No development artifact found for this job")

    target_root = Path(body.get("path") or artifact.get("path_or_url") or "").expanduser()
    if not str(target_root):
        raise HTTPException(400, "Provide a local target path")
    if not target_root.exists() or not target_root.is_dir():
        raise HTTPException(400, f"Local target path does not exist: {target_root}")

    overwrite = bool(body.get("overwrite", False))
    base = target_root if overwrite else target_root / ".qa-copilot" / "developed" / job_id
    written = []

    for item in artifact.get("files", []):
        out_path = _safe_join(base, item.get("path") or "file.txt")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if out_path.exists() and not overwrite:
            out_path = _safe_join(base, f"new/{item.get('path') or 'file.txt'}")
            out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(item.get("content", ""), encoding="utf-8")
        written.append(str(out_path))

    storage.update_development_artifact(job_id, {"last_saved_local": str(base), "last_saved_files": written})
    return {"target_dir": str(base), "files": written}


def _safe_join(root: Path, relative_path: str) -> Path:
    raw_parts = Path(str(relative_path).replace("\\", "/")).parts
    safe_parts = [
        part for part in raw_parts
        if part not in ("", ".", "..") and not part.endswith(":")
    ]
    if not safe_parts:
        safe_parts = ["file.txt"]
    out = root.joinpath(*safe_parts)
    try:
        out.resolve().relative_to(root.resolve())
    except ValueError:
        raise HTTPException(400, f"Unsafe path: {relative_path}")
    return out


@router.get("/generate/{job_id}/stream")
async def stream_generation(job_id: str):
    """SSE endpoint — connect with EventSource to receive real-time agent events."""
    job = storage.get_generation_jobs().get(job_id)
    if not job:
        raise HTTPException(404, "Generation job not found")

    stories_map   = storage.get_stories()
    story_ids     = job.get("story_ids", list(stories_map.keys()))
    stories_raw   = job.get("stories") or [v for k, v in stories_map.items() if k in story_ids]

    from models.schemas import UserStory
    stories = [UserStory(**s) for s in stories_raw]

    codebase_context = storage.get_generation_jobs().get(f"codebase_context_{job_id}", {})
    options = job.get("options", {})

    async def event_stream():
        try:
            async for chunk in generate_tests_stream(job_id, stories, codebase_context, options):
                yield chunk
        except Exception as e:
            from models.schemas import AgentEvent
            yield f"data: {AgentEvent(type='error', content=str(e)).model_dump_json()}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/", response_model=List[dict])
async def list_generation_jobs():
    return [
        v for v in storage.get_generation_jobs().values()
        if isinstance(v, dict) and "status" in v
    ]


@router.delete("/{test_id}")
async def delete_test(test_id: str):
    tests = storage.get_generated_tests()
    if test_id not in tests:
        raise HTTPException(404, "Test not found")
    with storage._lock:
        del storage._store["generated_tests"][test_id]
        storage._persist()
    return {"deleted": test_id}
