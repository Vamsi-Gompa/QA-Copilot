# Requirements Traceability Matrix

Source: `CMT-02_SDLC_Agentic_Framework-_End-to-End_New_Feature_Development_Automation.docx`

| Requirement / artifact | Implementation evidence | Verification |
|---|---|---|
| Text or uploaded requirement intake | Existing story upload plus `POST /api/lifecycles/` requirement intake | Lifecycle API tests and live smoke test |
| Structured intent, actors, rules, constraints, NFRs, assumptions, dependencies, open questions | `lifecycle.py::_build_lifecycle` normalized requirement object | `test_intake_generates_all_planning_artifacts_and_blocks_code` |
| Context pack and related prior artifacts | Persisted `context_pack` with relevance, decisions, and reusable patterns | Lifecycle intake test |
| Architect clarification loop | `PATCH /api/lifecycles/{id}/clarifications/{index}` and interactive UI answer capture | `test_clarification_and_versioned_brd_revision_are_audited` |
| Versioned BRD and confidence by section | BRD sections, confidence scores, immutable `brd_history`, revisions, approval gate | Revision test and BRD workspace |
| Epics, stories, subtasks, Given-When-Then criteria, points, dependencies | Persisted issue hierarchy and traceable criteria | Intake test and Board UI |
| Jira-style issue management | Five-column board, drag/status updates, issue creation and deletion | `test_jira_style_issue_create_move_and_delete` |
| Sprint plan, capacity, sequencing, critical path, risks, readiness | Persisted `sprint_plan` and Sprint Plan UI | Intake test |
| Human-in-the-loop control | BRD, code-plan, and release approval records with actor/comment/timestamp | Gate API tests; `HUMAN_INVOLVEMENT.md` |
| Code plan before implementation | Blocking gate plus modules and acceptance-criteria unit-test mapping | Full lifecycle test |
| Generated implementation and unit tests | Three-file development artifact persisted for Git delivery | Full lifecycle test |
| Branch, commit, push, repository creation, pull request | GitHub service and Git delivery UI; lifecycle bundle handed to `development_job_id` | API contract/type checks; external operation requires user token |
| Review against BRD and acceptance criteria | Review artifact with severity, coverage, and requirement references | Full lifecycle test |
| Sanity results mapped to issues and structured defects | Sanity artifact and automatic Defect issue creation | Full lifecycle test |
| Release notes and QA handoff ticket | Release artifact with scope, branch, tested areas, open items, entry criteria, and risks | Full lifecycle test |
| Knowledge/artifact lineage | Persisted requirement → BRD → issue → code plan → files → defect links | Full lifecycle test verifies at least 16 links |
| Local model / no external API key fallback | Deterministic template generator records `external_api_key_required: false` | Lifecycle intake response |
| Existing QA generation and execution | Story, generation, execution, scan/test, screenshots, discrepancy routes and UI | Existing application workflows |
| Reference REST modernization feature | Claim DTO/controller/service, 20-record dataset, OpenAPI, Postman, Docker | Claim unit/API tests |

## Verification commands

```powershell
python -m pytest backend\tests -q
cd frontend
node_modules\.bin\tsc.CMD --noEmit
```

Current result: 15 backend tests passed and the frontend TypeScript contract
checks without errors.
