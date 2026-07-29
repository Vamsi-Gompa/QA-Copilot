# AI QA Copilot — Claim Adjudication REST Modernization

This repository contains the existing AI QA Copilot and a complete reference
modernization of a legacy batch claim check into a synchronous REST endpoint.
The claim slice uses explicit DTO, service, and controller layers, a deterministic
20-record legacy extract, OpenAPI documentation, tests, and Postman examples.

## Repository structure

```text
backend/
  controllers/claim_controller.py  # HTTP/controller layer
  dtos/claim_dto.py                 # validated request/response contracts
  services/claim_service.py         # duplicate, eligibility, approval rules
  data/claims_dataset.json          # 20 mock legacy records
  tests/test_claim_*.py             # unit and endpoint tests
frontend/                            # existing React QA Copilot UI
postman/Claim-Adjudication.postman_collection.json
```

Supporting deliverables are [ARCHITECTURE.md](ARCHITECTURE.md),
[FIELD_MAPPING.md](FIELD_MAPPING.md), [PLAN.md](PLAN.md),
[PROMPTS.md](PROMPTS.md), [HUMAN_INVOLVEMENT.md](HUMAN_INVOLVEMENT.md), and
[PRESENTATION_WALKTHROUGH.md](PRESENTATION_WALKTHROUGH.md).

## Build and run

### Backend (Windows PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Alternatively, run `start-backend.bat`. Verify
`GET http://localhost:8001/health`.

### Frontend

```powershell
cd frontend
pnpm install
pnpm build
pnpm dev
```

### Docker

```powershell
docker compose up --build
```

The API is available at `http://localhost:8001`; interactive OpenAPI docs are
at `http://localhost:8001/docs` and the schema is at `/openapi.json`.

## Claim API

`POST /api/claims/adjudicate`

Rules are evaluated in this order:

1. Existing claim ID or matching member/date/procedure/amount → `DUPLICATE`.
2. Missing member, inactive coverage, or service outside coverage → `REJECTED`.
3. Amount over the automatic limit of 50,000.00 → `REJECTED`.
4. Otherwise → `APPROVED` for the submitted amount.

Domain outcomes use HTTP 200 and a machine-readable `decision` and
`reason_codes`. Contract validation failures use HTTP 422.

### Approved request

```bash
curl -X POST http://localhost:8001/api/claims/adjudicate \
  -H "Content-Type: application/json" \
  -d '{"claim_id":"CLM-NEW-001","member_id":"MBR-001","provider_id":"PRV-01","service_date":"2026-07-01","procedure_code":"99214","amount":140.50}'
```

```json
{
  "claim_id": "CLM-NEW-001",
  "decision": "APPROVED",
  "approved_amount": "140.50",
  "reason_codes": ["ELIGIBLE", "NO_DUPLICATE_FOUND"],
  "processed_at": "2026-07-29T10:00:00Z"
}
```

### Duplicate request/response

Submit the same payload with `"claim_id": "CLM-1001"`:

```json
{
  "claim_id": "CLM-1001",
  "decision": "DUPLICATE",
  "approved_amount": "0.00",
  "reason_codes": ["DUPLICATE_CLAIM"],
  "processed_at": "2026-07-29T10:00:00Z"
}
```

### Eligibility failure

Use member `MBR-004` with service date `2026-07-01`:

```json
{
  "claim_id": "CLM-NEW-003",
  "decision": "REJECTED",
  "approved_amount": "0.00",
  "reason_codes": ["MEMBER_NOT_ELIGIBLE"],
  "processed_at": "2026-07-29T10:00:00Z"
}
```

## Tests and coverage

```powershell
cd backend
python -m pytest tests/test_claim_service.py tests/test_claim_controller.py `
  --cov=dtos.claim_dto --cov=services.claim_service `
  --cov=controllers.claim_controller --cov-report=term-missing `
  --cov-fail-under=70
```

The suite covers approval, ID and business-key duplicates, ineligible and
unknown members, the automatic approval limit, normalization, malformed
requests, and non-positive amounts.
# Atlas SDLC Copilot — Requirement-to-Release Automation

Atlas SDLC Copilot turns a raw feature requirement into an approved BRD,
Jira-style backlog and sprint, code plan, implementation stub, mapped unit
tests, review findings, sanity defects, Git handoff, release notes, QA ticket,
and reusable artifact lineage. Human approval gates keep the architect in
control before planning, code generation, and release.

Open `http://localhost:5200/lifecycle` or choose **SDLC Workspace** in the
sidebar. The PoC uses a deterministic local fallback, so the full workflow does
not require an external LLM API key. Lifecycle state persists in
`backend/data/store.json`.

## Agentic SDLC workflow

1. Requirement intake and structured normalization.
2. Mock knowledge-graph context retrieval and clarification questions.
3. Versioned BRD with confidence scores and architect approval.
4. Jira-style epics, stories, subtasks, Given-When-Then criteria, estimates,
   dependencies, sprint capacity, critical path, and risk flags.
5. Architect-approved code plan, implementation stub, and unit-test mapping.
6. Traceable review, sanity validation, and automatic defect creation.
7. Repository and branch targeting, release notes, QA handoff, and lineage.

## Reference feature
