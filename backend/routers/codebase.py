from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import List
import uuid
from models.schemas import CodebaseSync, CodebaseSyncRequest, JobStatus
from services import storage
from services.codebase_scanner import scan_local_path, scan_git_repo

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_syncs():
    return list(storage.get_codebase_syncs().values())


@router.get("/latest")
async def get_latest():
    latest = storage.get_latest_codebase_sync()
    if not latest:
        raise HTTPException(404, "No codebase synced yet")
    return latest


@router.post("/sync")
async def sync_codebase(body: CodebaseSyncRequest, background_tasks: BackgroundTasks):
    sync = CodebaseSync(
        source_type=body.source_type,
        path_or_url=body.path_or_url,
        branch=body.branch,
        status=JobStatus.RUNNING,
    )
    storage.save_codebase_sync(sync)
    background_tasks.add_task(_do_scan, sync.id, body)
    return {"id": sync.id, "status": "running"}


@router.get("/{sync_id}")
async def get_sync(sync_id: str):
    syncs = storage.get_codebase_syncs()
    if sync_id not in syncs:
        raise HTTPException(404, "Sync not found")
    return syncs[sync_id]


async def _do_scan(sync_id: str, req: CodebaseSyncRequest):
    try:
        if req.source_type == "git":
            result = scan_git_repo(req.path_or_url, req.branch)
        else:
            result = scan_local_path(req.path_or_url)

        if "error" in result:
            storage.save_codebase_sync(CodebaseSync(
                id=sync_id,
                source_type=req.source_type,
                path_or_url=req.path_or_url,
                branch=req.branch,
                status=JobStatus.FAILED,
                structure_summary=result["error"],
            ))
            return

        storage.save_codebase_sync(CodebaseSync(
            id=sync_id,
            source_type=req.source_type,
            path_or_url=req.path_or_url,
            branch=req.branch,
            status=JobStatus.COMPLETED,
            file_count=result.get("file_count", 0),
            languages=result.get("languages", []),
            structure_summary=result.get("summary", ""),
        ))
        # Store full context for AI use
        storage.save_generation_job(f"codebase_context_{sync_id}", result)
    except Exception as e:
        storage.save_codebase_sync(CodebaseSync(
            id=sync_id,
            source_type=req.source_type,
            path_or_url=req.path_or_url,
            branch=req.branch,
            status=JobStatus.FAILED,
            structure_summary=str(e),
        ))
