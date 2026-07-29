from fastapi import APIRouter, HTTPException, BackgroundTasks, Body
from typing import List, Optional
import uuid
import httpx
from models.schemas import ExecutionJob, JobStatus, Discrepancy
from services import storage, execution_service
from agents.discrepancy_analyzer import analyze_discrepancies

router = APIRouter()


@router.get("/preflight")
async def preflight_app(app_url: str):
    """Check whether the app URL is reachable before running UI tests."""
    if not app_url:
        raise HTTPException(400, "app_url is required")
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True, verify=False) as client:
            res = await client.get(app_url)
        return {
            "running": True,
            "status_code": res.status_code,
            "message": f"Application responded with HTTP {res.status_code}",
        }
    except Exception as exc:
        return {
            "running": False,
            "status_code": None,
            "message": f"Application is not running or not reachable at {app_url}: {type(exc).__name__}",
        }


@router.post("/run")
async def start_execution(
    background_tasks: BackgroundTasks,
    test_ids: Optional[List[str]] = Body(default=None),
):
    tests_map = storage.get_generated_tests()

    if test_ids:
        # Preserve caller-specified order
        id_set = set(test_ids)
        by_id  = {tid: t for tid, t in tests_map.items() if tid in id_set}
        selected = [by_id[tid] for tid in test_ids if tid in by_id]
    else:
        # Run all approved (or generated) tests
        selected = [t for t in tests_map.values() if t["status"] in ("approved", "generated")]

    if not selected:
        raise HTTPException(400, "No tests to execute")

    from models.schemas import GeneratedTest
    test_objects = [GeneratedTest(**t) for t in selected]

    job = ExecutionJob(
        test_ids=[t["id"] for t in selected],
        total=len(selected),
    )
    storage.save_execution_job(job)

    background_tasks.add_task(execution_service.run_tests, job.id, test_objects)
    return {"job_id": job.id, "total": len(selected)}


@router.get("/jobs/", response_model=List[dict])
async def list_jobs():
    return list(storage.get_execution_jobs().values())


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    jobs = storage.get_execution_jobs()
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id]


@router.get("/jobs/{job_id}/results")
async def get_results(job_id: str):
    jobs = storage.get_execution_jobs()
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id].get("results", [])


@router.post("/jobs/{job_id}/analyze-discrepancies", response_model=List[dict])
async def analyze_job_discrepancies(job_id: str):
    jobs = storage.get_execution_jobs()
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    job = jobs[job_id]
    if job["status"] not in ("completed", "failed"):
        raise HTTPException(400, "Job not yet complete")

    from models.schemas import TestResult, GeneratedTest
    results = [TestResult(**r) for r in job.get("results", [])]
    tests_map = storage.get_generated_tests()
    tests = [GeneratedTest(**t) for t in tests_map.values()]

    discrepancies = await analyze_discrepancies(tests, results)
    return [d.model_dump() for d in discrepancies]
