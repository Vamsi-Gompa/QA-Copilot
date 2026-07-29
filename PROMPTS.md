# Prompt and Refinement Log

This log records the material AI-assisted design interactions for review. It
does not claim that generated output was accepted without engineering review.

Entries 5–15 below are history-backed reconstructions from the implemented QA
Copilot workflows, `source_document.txt`, and the prompt builders retained in
the repository. Their wording has been normalized for readability; they are not
presented as verbatim exports of unavailable chat messages.

## 1. Deliverable framing

**Prompt:** Create a buildable project with overview/build/run/API docs, a
before/after architecture, prompt log, phased plan, DTO/service/controller
layers, 70%+ tests, Postman cases, ~20 records, optional Docker, field mapping,
and a presentation walkthrough. Tests must cover approval, duplicates,
eligibility failure, and edge cases.

**Response summary:** Identified the repository as FastAPI + React and proposed
an isolated claim-adjudication feature within the existing backend rather than
replacing unrelated QA Copilot functionality.

**Refinement:** Selected `POST /api/claims/adjudicate` and made domain outcomes
HTTP 200 with enumerated decisions and reason codes; retained HTTP 422 for
malformed contracts.

## 2. Layering and rule extraction

**Prompt:** Ensure the source follows DTO, Service, Controller layers.

**Response summary:** Put Pydantic transport contracts in `backend/dtos`, pure
decision logic in `backend/services`, and FastAPI routing/dependency injection
in `backend/controllers`.

**Refinement:** Kept file loading behind `ClaimService.from_json()` so a future
database repository can replace the mock adapter without changing HTTP DTOs.

## 3. Duplicate and eligibility behavior

**Prompt:** Cover approved claims, duplicates, eligibility failures, and edge
cases.

**Response summary:** Defined duplicates by claim ID or a business fingerprint
(member, service date, procedure, amount). Eligibility requires a known member,
an active flag, and service date within coverage. Added an automatic approval
limit and positive-decimal validation.

**Refinement:** Used `Decimal` for monetary comparisons and stable reason codes
for auditable integrations.

## 4. Verification feedback

**Prompt:** Verify buildability and coverage.

**Response summary:** Added focused pytest and FastAPI TestClient coverage plus
a `--cov-fail-under=70` command.

**Refinement:** Static compilation is used as a fallback if the workstation's
installed Python dependency stack cannot import; a clean Python 3.12 virtual
environment or Docker image is the reproducible verification environment.

## 5. Requirement intake and normalization

**Prompt:** Accept a raw feature requirement and extract its intent, actors,
business rules, constraints, dependencies, non-functional requirements,
assumptions, and unanswered questions into one structured object.

**Response summary:** Designed the Intake stage to produce a reusable
requirement record with `REQ-1` as the traceability anchor for downstream
artifacts.

**Refinement:** Kept open questions visible instead of allowing the automation
to silently invent missing authorization, retention, or service-level rules.

## 6. Prior-context retrieval

**Prompt:** Before generating new work, identify related BRDs, user stories,
modules, defects, test suites, design decisions, and reusable implementation
patterns.

**Response summary:** Added a Context Agent output containing related artifacts,
prior decisions, relevance scores, and reusable patterns.

**Refinement:** The PoC uses deterministic mock knowledge-graph context so the
demo remains reproducible without external systems.

## 7. Clarification and scope lock

**Prompt:** Review the normalized requirement, ask targeted clarification
questions, record assumptions, and stop BRD progression until the architect
confirms the intended scope.

**Response summary:** Added explicit questions for user roles, production SLOs,
and retention rules, with the architect responsible for resolving ambiguity.

**Refinement:** Clarification is treated as a human control point rather than a
generative step that automatically fills critical gaps.

## 8. Versioned BRD generation

**Prompt:** Generate a concise, versioned BRD covering the executive summary,
business objective, functional scope, non-functional requirements, and
out-of-scope items, with confidence per section.

**Response summary:** Produced structured BRD sections with confidence scores
and an approval-required state.

**Refinement:** Added a formal BRD gate supporting `approved` and
`changes_requested`, including actor, timestamp, comment, and approval history.

## 9. Backlog decomposition

**Prompt:** Convert the approved requirement into an epic, INVEST-oriented user
stories, subtasks, Given-When-Then acceptance criteria, estimates, priorities,
dependencies, and requirement references.

**Response summary:** Generated a Jira-style hierarchy whose stories and
subtasks retain links to `REQ-1`.

**Refinement:** Added negative-path, authorization, observability, and release
documentation work so the backlog covers more than the happy path.

## 10. Sprint and risk planning

**Prompt:** Build a lightweight sprint plan with a goal, available capacity,
committed points, critical path, risks, sequencing, and handoff-readiness
indicator.

**Response summary:** Created a 13-point planning view with dependent delivery
steps and visible readiness risks.

**Refinement:** Kept estimates and assignments editable because Product Owners,
engineering leads, and team members—not the AI—own delivery commitments.

## 11. Code-plan-first generation

**Prompt:** Inspect the selected stories and codebase, then propose the modules,
API changes, UI changes, tests, branch, and acceptance-criterion mapping before
writing implementation code.

**Response summary:** Added a separate code-plan stage and made implementation
unavailable until the plan is approved.

**Refinement:** Added an architect code-plan gate to prevent unchecked
AI-generated design decisions from immediately becoming source changes.

## 12. Context-aware implementation

**Prompt:** Implement the selected feature against the synced local or Git
codebase, follow its architecture and conventions, generate unit tests, and
avoid unrelated file changes.

**Response summary:** Built a development flow that uses scanned code context,
selected technology settings, source location, target branch, and user stories.

**Refinement:** Added deterministic fallback artifacts and a preview/save step;
generated code remains reviewable before any Git operation.

## 13. Comprehensive QA test generation

**Prompt:** Generate backend, UI, and file-upload tests from the selected user
stories and actual codebase context, including positive, negative, boundary,
security, and custom mandatory scenarios.

**Response summary:** Added structured JSON test generation with story linkage,
priority, category, tags, source files, expected results, and editable data.

**Refinement:** Treated the synced codebase as the source of truth, required
story IDs to match selected stories, and exposed generated tests for human
approval or editing before execution.

## 14. Failure and discrepancy analysis

**Prompt:** Compare expected behavior with actual test output, explain the most
likely failure cause, assign severity, and propose a focused remediation.

**Response summary:** Added discrepancy analysis that combines test metadata,
execution output, errors, and acceptance expectations.

**Refinement:** AI analysis is advisory: a QA engineer or developer must verify
the diagnosis and approve changes, especially where the environment or test
itself may be at fault.

## 15. Review, sanity, and release handoff

**Prompt:** Review the implementation against the BRD and acceptance criteria,
run or simulate sanity tests, create structured defects for failures, and
prepare release notes plus a QA handoff with open risks.

**Response summary:** Connected review findings, coverage evidence, sanity
results, defect keys, release notes, and requirement-to-artifact lineage.

**Refinement:** Added a final release gate. Product, architecture, engineering,
QA, security, and release owners retain responsibility for readiness and
production authorization.

## Human review points

- Confirm the 50,000.00 automatic approval limit with the product owner.
- Confirm whether business duplicates should be scoped by provider.
- Replace mock member/claim data with an authenticated repository adapter.
- Decide whether duplicate/rejected domain outcomes should remain HTTP 200.
- Review generated tests for false positives, unsafe test data, and sufficient
  acceptance-criteria coverage before execution.
- Require named human approval at BRD, code-plan, pull-request, QA, and release
  boundaries in any production implementation.
