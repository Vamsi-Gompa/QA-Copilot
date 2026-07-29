from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from routers.lifecycle import router
from services import storage


app = FastAPI()
app.include_router(router, prefix="/api/lifecycles")
client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_lifecycles():
    storage._store["lifecycles"] = {}
    storage._store["development_artifacts"] = {}
    yield


def create_lifecycle():
    response = client.post(
        "/api/lifecycles/",
        json={
            "title": "Notification preferences",
            "requirement_text": (
                "Customers choose email or SMS notifications. "
                "Only verified channels may be selected. Changes must be audited."
            ),
            "project_key": "NOTIF",
            "sprint_name": "Sprint 1",
        },
    )
    assert response.status_code == 200
    return response.json()


def approve(lifecycle_id: str, gate: str):
    response = client.post(
        f"/api/lifecycles/{lifecycle_id}/gates/{gate}",
        json={"decision": "approved", "actor": "Architect", "comment": "Approved"},
    )
    assert response.status_code == 200
    return response.json()


def run(lifecycle_id: str, stage: str):
    response = client.post(f"/api/lifecycles/{lifecycle_id}/run/{stage}")
    assert response.status_code == 200, response.text
    return response.json()


def test_intake_generates_all_planning_artifacts_and_blocks_code():
    item = create_lifecycle()
    assert item["requirement"]["id"] == "REQ-1"
    assert item["context_pack"]["related_artifacts"]
    assert item["brd"]["version"] == 1
    assert {issue["type"] for issue in item["issues"]} == {"Epic", "Story", "Subtask"}
    assert item["sprint_plan"]["critical_path"]
    assert item["stages"]["brd"]["status"] == "approval_required"

    blocked = client.post(f"/api/lifecycles/{item['id']}/run/code_plan")
    assert blocked.status_code == 409


def test_clarification_and_versioned_brd_revision_are_audited():
    item = create_lifecycle()
    answered = client.patch(
        f"/api/lifecycles/{item['id']}/clarifications/0",
        json={"answer": "Administrators and account owners.", "actor": "Product Owner"},
    )
    assert answered.status_code == 200
    assert answered.json()["clarifications"][0]["status"] == "answered"
    assert "Administrators" in answered.json()["requirement"]["assumptions"][-1]

    revised = client.post(
        f"/api/lifecycles/{item['id']}/brd/revisions",
        json={
            "section_name": "Functional scope",
            "content": "Users can choose verified email and SMS channels.",
            "actor": "Architect",
        },
    )
    assert revised.status_code == 200
    body = revised.json()
    assert body["brd"]["version"] == 2
    assert body["brd_history"][0]["version"] == 1
    assert body["brd"]["status"] == "Draft"
    assert any(link["to"] == "BRD-v2" for link in body["lineage"])


def test_jira_style_issue_create_move_and_delete():
    item = create_lifecycle()
    created = client.post(
        f"/api/lifecycles/{item['id']}/issues",
        json={
            "issue_type": "Story",
            "summary": "Add notification audit export",
            "story_points": 3,
            "sprint": "Sprint 1",
        },
    )
    assert created.status_code == 200
    issue = created.json()["issues"][-1]
    assert issue["key"] == "NOTIF-9"

    moved = client.patch(
        f"/api/lifecycles/{item['id']}/issues/{issue['key']}",
        json={"status": "In Progress", "assignee": "Developer"},
    )
    assert moved.status_code == 200
    updated = next(x for x in moved.json()["issues"] if x["key"] == issue["key"])
    assert updated["status"] == "In Progress"

    deleted = client.delete(f"/api/lifecycles/{item['id']}/issues/{issue['key']}")
    assert deleted.status_code == 200
    assert all(x["key"] != issue["key"] for x in deleted.json()["issues"])


def test_full_approved_flow_produces_code_defect_release_and_lineage():
    item = create_lifecycle()
    lifecycle_id = item["id"]
    approve(lifecycle_id, "brd")
    plan = run(lifecycle_id, "code_plan")
    assert plan["code_plan"]["unit_test_mapping"]
    approve(lifecycle_id, "code_plan")
    implementation = run(lifecycle_id, "implementation")
    assert len(implementation["implementation"]["files"]) == 3
    assert lifecycle_id in storage.get_development_artifacts()

    review = run(lifecycle_id, "review")
    assert review["review"]["coverage_percent"] == 100
    sanity = run(lifecycle_id, "sanity")
    assert sanity["sanity"]["defect_keys"]
    assert any(x["type"] == "Defect" for x in sanity["issues"])
    release = run(lifecycle_id, "release")
    assert release["release"]["qa_handoff"]["tested"]
    final = approve(lifecycle_id, "release")
    assert final["status"] == "Ready for QA"
    assert len(final["lineage"]) >= 16
