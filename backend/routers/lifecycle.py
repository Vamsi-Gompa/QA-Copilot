"""Deterministic, self-contained SDLC lifecycle orchestration.

The PoC deliberately uses template generation so the complete demo works without
an external model.  The artifacts are persisted and may later be enriched by an
Ollama-backed agent without changing the API contract.
"""
from datetime import datetime
import re
import uuid

from fastapi import APIRouter, HTTPException

from models.schemas import (
    LifecycleCreateRequest,
    LifecycleGateRequest,
    LifecycleIssueUpdate,
    LifecycleRepositoryRequest,
)
from services import storage

router = APIRouter()

STAGES = [
    "intake",
    "context",
    "brd",
    "planning",
    "code_plan",
    "implementation",
    "review",
    "sanity",
    "release",
]


def _now() -> str:
    return datetime.utcnow().isoformat()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "feature"


def _sentences(text: str) -> list[str]:
    return [
        item.strip(" \t\r\n-•")
        for item in re.split(r"(?<=[.!?])\s+|\r?\n+", text)
        if len(item.strip()) > 12
    ]


def _issue(key: str, issue_type: str, summary: str, description: str, **extra) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "key": key,
        "type": issue_type,
        "summary": summary,
        "description": description,
        "status": extra.pop("status", "Backlog"),
        "priority": extra.pop("priority", "Medium"),
        "assignee": extra.pop("assignee", "Unassigned"),
        "story_points": extra.pop("story_points", 0),
        "sprint": extra.pop("sprint", ""),
        "parent_key": extra.pop("parent_key", ""),
        "dependencies": extra.pop("dependencies", []),
        "acceptance_criteria": extra.pop("acceptance_criteria", []),
        "requirement_refs": extra.pop("requirement_refs", ["REQ-1"]),
        "created_at": _now(),
        **extra,
    }


def _build_issues(project_key: str, title: str, sprint: str, rules: list[str]) -> list[dict]:
    key = re.sub(r"[^A-Z0-9]", "", project_key.upper())[:8] or "SDLC"
    criteria = [
        f"Given the feature is available, when the user performs the primary {title.lower()} flow, then the expected outcome is completed successfully.",
        "Given invalid or incomplete input, when the request is submitted, then a clear validation message is shown and no partial data is saved.",
        "Given an authorized user completes the flow, when the result is stored, then an auditable trace links it to REQ-1.",
    ]
    if rules:
        criteria[0] = f"Given the documented business rules, when {rules[0].lower()}, then the system records the expected outcome."
    issues = [
        _issue(f"{key}-1", "Epic", title, f"Deliver {title} from approved requirement through QA handoff.", priority="High", sprint=sprint),
        _issue(
            f"{key}-2", "Story", f"Implement core {title.lower()} experience",
            "As an end user, I want the core feature flow so that I can complete the business task.",
            parent_key=f"{key}-1", story_points=5, sprint=sprint, status="Selected",
            acceptance_criteria=criteria,
        ),
        _issue(
            f"{key}-3", "Story", "Add validation, security and failure handling",
            "As a product owner, I want safe and explicit failure handling so that the feature is reliable.",
            parent_key=f"{key}-1", story_points=3, sprint=sprint, priority="High",
            dependencies=[f"{key}-2"], acceptance_criteria=[
                "Given an invalid request, when it is processed, then validation fails with an actionable message.",
                "Given an unauthorized request, when it reaches the service, then access is denied and audited.",
            ],
        ),
        _issue(
            f"{key}-4", "Story", "Add observability and release documentation",
            "As a support engineer, I want traceable events and release notes so that the feature can be operated safely.",
            parent_key=f"{key}-1", story_points=2, sprint=sprint,
            dependencies=[f"{key}-2"], acceptance_criteria=[
                "Given a completed workflow, when support inspects it, then requirement, code and test lineage is visible.",
            ],
        ),
    ]
    for number, (parent, summary) in enumerate([
        (f"{key}-2", "Create API contract and domain model"),
        (f"{key}-2", "Build user interface and state handling"),
        (f"{key}-3", "Implement negative paths and access checks"),
        (f"{key}-4", "Add telemetry, tests and release notes"),
    ], start=5):
        issues.append(_issue(
            f"{key}-{number}", "Subtask", summary, summary,
            parent_key=parent, sprint=sprint, story_points=1,
        ))
    return issues


def _build_lifecycle(body: LifecycleCreateRequest) -> dict:
    lifecycle_id = str(uuid.uuid4())
    lines = _sentences(body.requirement_text)
    intent = lines[0] if lines else body.requirement_text.strip()
    rules = lines[1:5]
    project_key = re.sub(r"[^A-Z0-9]", "", body.project_key.upper())[:8] or "SDLC"
    issues = _build_issues(project_key, body.title, body.sprint_name, rules)
    branch = f"feature/{_slug(body.title)}"
    requirement = {
        "id": "REQ-1",
        "title": body.title,
        "intent": intent,
        "actors": ["End User", "Architect", "Product Owner", "Developer", "QA Engineer"],
        "business_rules": rules or ["The approved feature scope must be implemented and traceable."],
        "constraints": ["Preserve existing behavior", "No external LLM key is required for the PoC"],
        "non_functional_requirements": ["Auditable", "Secure by default", "Recoverable", "Testable"],
        "dependencies": ["Source repository", "QA environment"],
        "assumptions": ["The architect validates scope before implementation begins."],
        "open_questions": [
            "Which user roles may perform this feature?",
            "What production SLO and data-retention rules apply?",
        ],
        "source": body.source_name,
    }
    context = {
        "related_artifacts": [
            {"type": "Decision", "name": "Use approval gates before code generation", "relevance": 0.94},
            {"type": "Pattern", "name": "FastAPI service + React workflow UI", "relevance": 0.89},
            {"type": "Test suite", "name": "Existing generated QA regression assets", "relevance": 0.77},
        ],
        "prior_decisions": ["All generated artifacts retain requirement references.", "Deterministic fallback is always available."],
        "reusable_patterns": ["API/service separation", "Jira-style issue hierarchy", "Given-When-Then criteria"],
    }
    brd_sections = [
        {"name": "Executive summary", "content": intent, "confidence": 0.96},
        {"name": "Business objective", "content": f"Deliver {body.title} with controlled, traceable SDLC automation.", "confidence": 0.92},
        {"name": "Functional scope", "content": " ".join(requirement["business_rules"]), "confidence": 0.84},
        {"name": "Non-functional requirements", "content": ", ".join(requirement["non_functional_requirements"]), "confidence": 0.88},
        {"name": "Out of scope", "content": "Production enterprise connectors and autonomous production deployment.", "confidence": 0.91},
    ]
    stages = {
        stage: {
            "status": "completed" if stage in ("intake", "context") else "waiting",
            "updated_at": _now(),
        }
        for stage in STAGES
    }
    stages["brd"]["status"] = "approval_required"
    lifecycle = {
        "id": lifecycle_id,
        "project_key": project_key,
        "title": body.title,
        "status": "In discovery",
        "current_stage": "brd",
        "created_at": _now(),
        "updated_at": _now(),
        "model": {"provider": "template-fallback", "local": True, "external_api_key_required": False},
        "requirement": requirement,
        "context_pack": context,
        "clarifications": [
            {"question": q, "answer": "", "status": "open"} for q in requirement["open_questions"]
        ],
        "brd": {"version": 1, "status": "Draft", "sections": brd_sections, "approved_by": "", "approved_at": None},
        "issues": issues,
        "sprint_plan": {
            "name": body.sprint_name,
            "goal": f"Deliver a reviewable vertical slice of {body.title}.",
            "capacity_points": 13,
            "committed_points": sum(i["story_points"] for i in issues if i["type"] == "Story"),
            "critical_path": [f"{project_key}-2", f"{project_key}-3", f"{project_key}-4"],
            "risks": ["Open authorization rules", "QA environment readiness"],
            "handoff_readiness": 35,
        },
        "code_plan": {
            "status": "Not generated",
            "branch": branch,
            "base_branch": body.base_branch,
            "repository": body.repository,
            "modules": [],
            "unit_test_mapping": [],
            "approved_by": "",
        },
        "implementation": {"status": "Not generated", "files": [], "development_job_id": lifecycle_id},
        "review": {"status": "Not started", "findings": [], "coverage_percent": 0},
        "sanity": {"status": "Not started", "passed": 0, "failed": 0, "results": [], "defect_keys": []},
        "release": {"status": "Not ready", "notes": "", "qa_handoff": {}, "open_risks": []},
        "repository": {
            "repo": body.repository,
            "base_branch": body.base_branch,
            "target_branch": branch,
            "commit_sha": "",
            "pull_request_url": "",
            "status": "Not configured" if not body.repository else "Configured",
        },
        "stages": stages,
        "approvals": [],
        "lineage": [
            {"from": "REQ-1", "to": "BRD-v1", "type": "defines"},
            *[{"from": "REQ-1", "to": issue["key"], "type": "decomposes_to"} for issue in issues],
        ],
        "activity": [{"at": _now(), "actor": "Intake Agent", "message": "Requirement normalized and context pack retrieved."}],
    }
    return lifecycle


def _get_or_404(lifecycle_id: str) -> dict:
    item = storage.get_lifecycles().get(lifecycle_id)
    if not item:
        raise HTTPException(404, "Lifecycle not found")
    return item


def _save(item: dict, actor: str, message: str) -> dict:
    item["updated_at"] = _now()
    item.setdefault("activity", []).insert(0, {"at": _now(), "actor": actor, "message": message})
    storage.save_lifecycle(item)
    return item


@router.get("/")
async def list_lifecycles():
    return sorted(storage.get_lifecycles().values(), key=lambda x: x["updated_at"], reverse=True)


@router.post("/")
async def create_lifecycle(body: LifecycleCreateRequest):
    if not body.requirement_text.strip():
        raise HTTPException(400, "Requirement text is required")
    item = _build_lifecycle(body)
    storage.save_lifecycle(item)
    return item


@router.get("/{lifecycle_id}")
async def get_lifecycle(lifecycle_id: str):
    return _get_or_404(lifecycle_id)


@router.patch("/{lifecycle_id}/issues/{issue_key}")
async def update_issue(lifecycle_id: str, issue_key: str, body: LifecycleIssueUpdate):
    item = _get_or_404(lifecycle_id)
    issue = next((x for x in item["issues"] if x["key"] == issue_key), None)
    if not issue:
        raise HTTPException(404, "Issue not found")
    issue.update({k: v for k, v in body.model_dump().items() if v is not None})
    return _save(item, "Plan Agent", f"{issue_key} updated.")


@router.post("/{lifecycle_id}/gates/{gate}")
async def decide_gate(lifecycle_id: str, gate: str, body: LifecycleGateRequest):
    item = _get_or_404(lifecycle_id)
    if gate not in ("brd", "code_plan", "release"):
        raise HTTPException(400, "Supported gates: brd, code_plan, release")
    decision = body.decision.lower()
    if decision not in ("approved", "changes_requested"):
        raise HTTPException(400, "Decision must be approved or changes_requested")
    item["approvals"].append({
        "gate": gate, "decision": decision, "comment": body.comment,
        "actor": body.actor, "at": _now(),
    })
    if gate == "brd":
        item["brd"]["status"] = "Approved" if decision == "approved" else "Changes requested"
        item["brd"]["approved_by"] = body.actor if decision == "approved" else ""
        item["brd"]["approved_at"] = _now() if decision == "approved" else None
        item["stages"]["brd"]["status"] = "completed" if decision == "approved" else "approval_required"
        if decision == "approved":
            item["stages"]["planning"]["status"] = "completed"
            item["stages"]["code_plan"]["status"] = "ready"
            item["current_stage"] = "code_plan"
            item["status"] = "Planned"
    elif gate == "code_plan":
        item["code_plan"]["status"] = "Approved" if decision == "approved" else "Changes requested"
        item["code_plan"]["approved_by"] = body.actor if decision == "approved" else ""
        item["stages"]["code_plan"]["status"] = "completed" if decision == "approved" else "approval_required"
        if decision == "approved":
            item["stages"]["implementation"]["status"] = "ready"
            item["current_stage"] = "implementation"
    else:
        item["release"]["status"] = "Approved" if decision == "approved" else "Changes requested"
        item["stages"]["release"]["status"] = "completed" if decision == "approved" else "approval_required"
        if decision == "approved":
            item["status"] = "Ready for QA"
            item["current_stage"] = "release"
    return _save(item, body.actor, f"{gate.replace('_', ' ').title()} gate {decision.replace('_', ' ')}.")


@router.post("/{lifecycle_id}/run/{stage}")
async def run_stage(lifecycle_id: str, stage: str):
    item = _get_or_404(lifecycle_id)
    if stage == "code_plan":
        if item["brd"]["status"] != "Approved":
            raise HTTPException(409, "Approve the BRD before generating a code plan")
        stories = [x for x in item["issues"] if x["type"] == "Story"]
        item["code_plan"].update({
            "status": "Approval required",
            "modules": [
                {"path": "backend/routers/feature.py", "purpose": "Feature API and validation"},
                {"path": "backend/services/feature_service.py", "purpose": "Domain rules and persistence"},
                {"path": "frontend/src/pages/Feature.tsx", "purpose": "Feature workflow experience"},
                {"path": "backend/tests/test_feature.py", "purpose": "Unit and API regression tests"},
            ],
            "unit_test_mapping": [
                {"story": story["key"], "criteria": story["acceptance_criteria"], "test": f"test_{_slug(story['summary']).replace('-', '_')}"}
                for story in stories
            ],
        })
        item["stages"]["code_plan"]["status"] = "approval_required"
        item["lineage"].extend([
            {"from": story["key"], "to": f"CODEPLAN-{item['id'][:8]}", "type": "implemented_by"}
            for story in stories
        ])
        return _save(item, "Code Agent", "Code plan and acceptance-criteria test mapping generated.")
    if stage == "implementation":
        if item["code_plan"]["status"] != "Approved":
            raise HTTPException(409, "Approve the code plan before implementation")
        title = item["title"]
        files = [
            {
                "path": f"generated/{_slug(title)}/README.md",
                "purpose": "Implementation handoff",
                "content": f"# {title}\n\nGenerated from REQ-1 and approved BRD-v{item['brd']['version']}.\n",
            },
            {
                "path": f"generated/{_slug(title)}/feature.py",
                "purpose": "Sample implementation stub",
                "content": (
                    '"""Generated implementation stub with requirement lineage."""\n'
                    "from dataclasses import dataclass\n\n"
                    "@dataclass\nclass FeatureResult:\n    success: bool\n    message: str\n\n"
                    "def execute_feature(payload: dict) -> FeatureResult:\n"
                    "    if not payload:\n        return FeatureResult(False, \"payload is required\")\n"
                    "    return FeatureResult(True, \"feature completed\")\n"
                ),
            },
            {
                "path": f"generated/{_slug(title)}/test_feature.py",
                "purpose": "Unit tests mapped to acceptance criteria",
                "content": (
                    "from feature import execute_feature\n\n"
                    "def test_primary_flow():\n    assert execute_feature({'value': 'valid'}).success\n\n"
                    "def test_rejects_empty_payload():\n    assert not execute_feature({}).success\n"
                ),
            },
        ]
        item["implementation"] = {"status": "Generated", "files": files, "development_job_id": item["id"]}
        storage.save_development_artifact(item["id"], {
            "job_id": item["id"], "status": "completed", "root": "",
            "files": files, "source_type": "lifecycle",
            "path_or_url": item["repository"]["repo"], "branch": item["repository"]["target_branch"],
            "save_target": "github",
        })
        item["stages"]["implementation"]["status"] = "completed"
        item["stages"]["review"]["status"] = "ready"
        item["current_stage"] = "review"
        item["status"] = "In development"
        for file in files:
            item["lineage"].append({"from": "CODEPLAN-" + item["id"][:8], "to": file["path"], "type": "produces"})
        return _save(item, "Code Agent", "Implementation stub and mapped unit tests generated.")
    if stage == "review":
        if item["implementation"]["status"] != "Generated":
            raise HTTPException(409, "Generate implementation before review")
        item["review"] = {
            "status": "Completed",
            "coverage_percent": 100,
            "findings": [
                {"severity": "medium", "status": "open", "summary": "Confirm production authorization policy", "requirement_ref": "REQ-1"},
                {"severity": "info", "status": "accepted", "summary": "All stories retain requirement and test lineage", "requirement_ref": "REQ-1"},
            ],
        }
        item["stages"]["review"]["status"] = "completed"
        item["stages"]["sanity"]["status"] = "ready"
        item["current_stage"] = "sanity"
        return _save(item, "Review Agent", "Code reviewed against the BRD and all acceptance criteria.")
    if stage == "sanity":
        if item["review"]["status"] != "Completed":
            raise HTTPException(409, "Complete review before sanity validation")
        project_key = item["project_key"]
        defect_key = f"{project_key}-{len(item['issues']) + 1}"
        defect = _issue(
            defect_key, "Defect", "Production authorization policy is not configured",
            "Review identified an open authorization decision that must be closed before production.",
            status="Backlog", priority="High", requirement_refs=["REQ-1"],
        )
        item["issues"].append(defect)
        item["sanity"] = {
            "status": "Completed with risks", "passed": 2, "failed": 1,
            "results": [
                {"name": "Primary feature flow", "status": "passed", "issue": f"{project_key}-2"},
                {"name": "Empty payload validation", "status": "passed", "issue": f"{project_key}-3"},
                {"name": "Production authorization policy", "status": "failed", "issue": defect_key},
            ],
            "defect_keys": [defect_key],
        }
        item["stages"]["sanity"]["status"] = "completed"
        item["stages"]["release"]["status"] = "ready"
        item["current_stage"] = "release"
        item["lineage"].append({"from": "REQ-1", "to": defect_key, "type": "validated_by"})
        return _save(item, "Sanity Agent", f"Sanity completed; structured defect {defect_key} created.")
    if stage == "release":
        if not item["sanity"]["status"].startswith("Completed"):
            raise HTTPException(409, "Complete sanity validation before release handoff")
        item["release"] = {
            "status": "Approval required",
            "notes": f"{item['title']} implementation stub, mapped unit tests, review findings and sanity evidence are ready for QA.",
            "qa_handoff": {
                "scope": item["title"],
                "build": item["repository"]["target_branch"],
                "tested": ["Primary flow", "Input validation", "Requirement lineage"],
                "open_items": item["sanity"]["defect_keys"],
                "entry_criteria": "Deploy the feature branch to the QA environment and resolve high-priority defects.",
            },
            "open_risks": [x["summary"] for x in item["review"]["findings"] if x["status"] == "open"],
        }
        item["stages"]["release"]["status"] = "approval_required"
        return _save(item, "Release Agent", "Release notes and QA handoff ticket generated.")
    raise HTTPException(400, "Runnable stages: code_plan, implementation, review, sanity, release")


@router.post("/{lifecycle_id}/repository")
async def configure_repository(lifecycle_id: str, body: LifecycleRepositoryRequest):
    item = _get_or_404(lifecycle_id)
    item["repository"].update({
        "repo": body.repository,
        "base_branch": body.base_branch,
        "target_branch": body.target_branch,
        "status": "Configured",
    })
    item["code_plan"].update({
        "repository": body.repository,
        "base_branch": body.base_branch,
        "branch": body.target_branch,
    })
    return _save(item, "Git Agent", f"Repository target configured: {body.repository} ({body.target_branch}).")
