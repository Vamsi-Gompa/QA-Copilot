from fastapi import APIRouter
from models.schemas import DashboardStats
from services import storage

router = APIRouter()


@router.get("/stats", response_model=DashboardStats)
async def get_stats():
    stories = storage.get_stories()
    tests = storage.get_generated_tests()
    exec_jobs = storage.get_execution_jobs()

    total_executed = sum(j.get("total", 0) for j in exec_jobs.values())
    total_passed = sum(j.get("passed", 0) for j in exec_jobs.values())
    pass_rate = round(total_passed / total_executed * 100, 1) if total_executed else 0.0

    approved = sum(1 for t in tests.values() if t.get("status") == "approved")

    # Rough time saved: ~30 min per test manually
    time_saved = round(len(tests) * 0.5, 1)

    return DashboardStats(
        total_stories=len(stories),
        total_tests_generated=len(tests),
        tests_approved=approved,
        tests_executed=total_executed,
        pass_rate=pass_rate,
        time_saved_hours=time_saved,
        generation_jobs=sum(
            1 for v in storage.get_generation_jobs().values()
            if isinstance(v, dict) and "status" in v
        ),
        execution_jobs=len(exec_jobs),
        recent_activity=storage.get_activity_log()[:10],
    )
