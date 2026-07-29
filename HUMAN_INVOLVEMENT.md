# Human Involvement in the SDLC Automation Project

## Purpose

The QA Copilot and SDLC Agentic Framework automate repetitive analysis,
generation, traceability, and reporting. They do not replace human
accountability. Humans establish intent, approve consequential decisions,
review generated artifacts, authorize source-control changes, interpret test
evidence, accept risk, and decide whether a release may proceed.

The governing principle is:

> Agents prepare and recommend; named humans review, decide, and remain
> accountable.

## Human involvement summary

These are estimated PoC effort shares, not production measurements.

| Stage | Human | Automated |
|---|---:|---:|
| Requirement intake | 40% | 60% |
| Context and clarification | 25% | 75% |
| BRD creation and approval | 45% | 55% |
| Backlog and sprint planning | 50% | 50% |
| Code planning | 45% | 55% |
| Implementation | 30% | 70% |
| Code review | 50% | 50% |
| Sanity testing | 35% | 65% |
| Release and QA handoff | 65% | 35% |
| **Overall average** | **43%** | **57%** |

**Summary:** The framework automates about **57%** of repeatable work while
humans contribute about **43%**, mainly through clarification, approvals,
review, risk acceptance, and release decisions. Human accountability at the
BRD, code-plan, and release gates remains **100%**.

## Human involvement across the lifecycle

| SDLC stage | Automation contribution | Required human involvement | Primary owner | Evidence retained |
|---|---|---|---|---|
| Requirement intake | Extracts intent, actors, rules, constraints, dependencies, and open questions | Correct inaccurate extraction; provide business context; identify sensitive or regulated data | Business Analyst / Product Owner | Source name, normalized requirement, corrections |
| Context retrieval | Finds related artifacts, prior decisions, defects, modules, and reusable patterns | Confirm relevance; reject stale or inappropriate precedent | Architect / BA | Context pack and relevance scores |
| Clarification | Generates targeted questions and records assumptions | Answer unresolved questions and explicitly lock scope | Architect / Product Owner | Questions, answers, assumptions, comments |
| BRD generation | Produces versioned sections and confidence scores | Review scope, rules, NFRs, exclusions, and low-confidence content | Product Owner / Architect | BRD version and BRD-gate decision |
| Backlog generation | Creates epics, stories, subtasks, criteria, dependencies, and estimates | Refine value, priority, estimates, ownership, and Definition of Done | Product Owner / Engineering Lead | Edited issues and activity history |
| Sprint planning | Proposes sequencing, capacity, risks, and critical path | Commit work based on actual skills, availability, and dependencies | Product Owner / Delivery Team | Approved sprint scope and risk register |
| Code planning | Proposes modules, contracts, test mapping, and branch strategy | Validate architecture, security, privacy, compatibility, and operational impact | Architect / Tech Lead | Code-plan-gate decision and rationale |
| Implementation | Generates candidate code and unit tests using repository context | Inspect every change; correct logic; protect secrets; verify licenses and conventions | Developer | Diff, review comments, local test evidence |
| Git operations | Prepares branch, commit, and pull-request metadata | Authorize push; review commit scope; approve and merge the PR | Developer / Maintainer | Commit SHA, PR, approvals, CI results |
| QA generation | Produces positive, negative, boundary, security, UI, and API tests | Validate expected behavior, test data, coverage, and false-positive risk | QA Engineer | Approved/edited test cases |
| Test execution | Runs selected tests and captures output, timing, errors, and screenshots | Confirm environment validity; triage flaky or misleading failures | QA Engineer / Developer | Execution job, logs, screenshots |
| Failure analysis | Suggests severity, cause, and remediation | Reproduce and verify findings; decide defect versus test/environment issue | QA Engineer / Developer | Triage note and defect decision |
| Release handoff | Summarizes changes, tests, defects, residual risks, and lineage | Verify readiness, accept residual risk, plan rollback, and authorize release | QA Lead / Product Owner / Release Manager | QA sign-off and release-gate record |
| Production operation | May summarize telemetry and incidents | Monitor, respond, rollback, communicate impact, and conduct post-incident review | Operations / SRE / Service Owner | Monitoring, incident, and audit records |

## Implemented human-in-the-loop gates

The lifecycle API implements three explicit gates. Every decision records the
gate, decision, comment, actor, and timestamp in the lifecycle approval history.

### 1. BRD approval gate

Before planning and code design proceed, the architect or product owner reviews:

- Business intent and scope.
- Actors and authorization assumptions.
- Functional and non-functional requirements.
- Constraints, dependencies, exclusions, and unanswered questions.
- Section confidence and any generated content requiring correction.

`changes_requested` returns the BRD to an approval-required state.

### 2. Code-plan approval gate

Implementation remains blocked until the BRD is approved and the code plan is
reviewed. The architect or technical lead checks:

- Proposed modules and responsibility boundaries.
- API and data-contract compatibility.
- Security, privacy, performance, and operability implications.
- Unit-test and acceptance-criterion mapping.
- Repository, base branch, target branch, and change scope.

Approval authorizes generation of a candidate implementation—not automatic
merge or production deployment.

### 3. Release approval gate

Release approval follows implementation review and sanity evidence. Human
reviewers check:

- Acceptance-criterion coverage and test outcomes.
- Open defects, failed or skipped tests, and discrepancy analyses.
- Security and compliance evidence where applicable.
- Release notes, QA handoff, monitoring, rollback, and residual risks.
- Traceability from requirement through BRD, stories, code, tests, and defects.

Approval indicates readiness for QA/release workflow. Production deployment
still follows organizational change-management controls.

## Additional controls required for production

The PoC gate model should be extended with:

- Pull-request approval by someone other than the code author.
- Security review for authentication, authorization, sensitive data, dependency
  changes, and threat-model impacts.
- QA sign-off tied to a controlled test environment and approved test data.
- Product acceptance against the original business outcome.
- Release-manager authorization, rollback readiness, and change window.
- Emergency override requiring a named actor, rationale, expiry, and later
  review.

No agent should approve its own output, merge directly to a protected branch,
alter production data, or deploy to production without an authorized human.

## Responsibility model

| Decision or artifact | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Requirement and BRD | Business Analyst | Product Owner | Architect, QA Lead | Delivery team |
| Architecture and code plan | Tech Lead | Architect | Security, Developers, SRE | Product Owner |
| Generated implementation | Developer | Engineering Lead | Architect, Security | QA |
| Test strategy and evidence | QA Engineer | QA Lead | Developer, Product Owner | Release Manager |
| Pull request and merge | Developer / Reviewer | Repository Maintainer | QA, Architect | Delivery team |
| Release decision | Release Manager | Product Owner / Service Owner | QA, Security, SRE | Stakeholders |

One person may hold multiple roles in the PoC, but each approval should still be
recorded under the role being exercised.

## Human review checklist

Before approving an AI-generated artifact, the reviewer should confirm:

- The source requirement is current and correctly represented.
- Facts are supported; assumptions and unresolved questions are visible.
- Acceptance criteria are measurable and cover positive and negative behavior.
- Generated code is understood, scoped, secure, maintainable, and free of
  credentials or personal data.
- Tests assert business outcomes rather than merely increasing line coverage.
- Failures were reproduced and were not caused by invalid data or environment.
- Traceability links point to the correct requirement, story, code, and test.
- Residual risks, monitoring, rollback, and owners are documented.

## Audit and accountability

For every gate, retain:

1. Artifact version or immutable reference.
2. Human actor and organizational role.
3. Decision: approved or changes requested.
4. Timestamp and rationale/comment.
5. Findings, exceptions, and conditions of approval.
6. References to tests, pull requests, defects, and release evidence.

Automation can make the process faster and more consistent, but the named human
approver remains accountable for the decision.

## PoC limitations

Some PoC stages use deterministic templates, mock knowledge-graph data, or
simulated review/sanity results. Those outputs demonstrate orchestration and
traceability; they are not substitutes for production architecture review,
executed CI tests, security assessment, QA sign-off, or release authorization.
