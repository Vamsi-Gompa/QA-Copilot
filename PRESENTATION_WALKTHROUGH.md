# Project Presentation Walkthrough

Use this as a 6–8 minute recording script. It is aligned to the implementation,
quality, modernization, documentation, and innovation rubric areas.

## 0:00–0:45 — Problem and outcome

Show `ARCHITECTURE.md`. Explain that the legacy path waits for an overnight
file, couples business rules to batch I/O, and reports failures at file level.
The new endpoint provides an immediate, traceable decision while preserving
legacy field meaning through an explicit mapping.

## 0:45–1:45 — Layered implementation

Open `backend/dtos/claim_dto.py`, `backend/services/claim_service.py`, and
`backend/controllers/claim_controller.py`. Highlight:

- Pydantic validates and normalizes the contract.
- `Decimal` avoids monetary rounding errors.
- The service has no FastAPI dependency and is directly unit-testable.
- Dependency injection leaves a seam for replacing JSON with a database.

## 1:45–2:45 — Business rules and innovation

Walk through rule ordering: ID/business-fingerprint duplicate detection,
coverage-window eligibility, an automatic approval guardrail, then approval.
Call out stable reason codes, UTC timestamps, and deterministic behavior.
Describe the low-risk strangler pattern: clients move to REST while the legacy
source can remain behind an adapter until migration is complete.

## 2:45–4:00 — Live API demonstration

Start the API and open `/docs`. Execute:

1. `CLM-NEW-001` / `MBR-001` / 2026-07-01 / 99214 / 140.50 → `APPROVED`.
2. Claim ID `CLM-1001` → `DUPLICATE`.
3. `MBR-004` with a 2026 service date → `REJECTED`, `MEMBER_NOT_ELIGIBLE`.
4. Amount `0` → HTTP 422.

Repeat the three domain cases from the Postman collection to demonstrate a
consumer-ready artifact.

## 4:00–5:00 — Test evidence

Run the coverage command from `README.md`. Point out service tests for both
duplicate methods, active/inactive/unknown members, the threshold, normalization,
and invalid amounts, then controller tests for success and contract validation.
Show the reported total and that the command fails below 70%.

## 5:00–6:00 — Delivery readiness

Show the 20 records, field mapping, OpenAPI docs, Dockerfile, Compose file, and
phased plan. Mention container health checks and the Linux-safe certificate
bootstrap. Close with production next steps: persistent repository, authentication
and authorization, observability, idempotency retention, and contract/load tests.

## Recording checklist

- Use 1080p and zoom the editor to readable text.
- Keep terminal commands and all four responses visible.
- Do not expose API keys, tokens, member PII, or local environment files.
- Export as MP4/H.264 and verify audio before submission.
