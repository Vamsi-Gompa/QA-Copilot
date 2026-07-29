# Phased Build Plan

| Phase | Milestone | Done means |
|---|---|---|
| 1. Discovery | Freeze legacy behavior and field meanings | Mapping reviewed; approval, duplicate, and eligibility outcomes named |
| 2. Contract | Define request/response DTOs | OpenAPI renders; invalid identifiers, codes, dates, and amounts return 422 |
| 3. Domain | Extract deterministic adjudication service | Rules have no HTTP dependency and return stable reason codes |
| 4. Adapter | Load representative legacy data | Exactly 20 mock records include active and inactive coverage |
| 5. API | Publish controller endpoint | `POST /api/claims/adjudicate` handles all domain outcomes |
| 6. Quality | Add unit and API tests | Approved, both duplicate paths, eligibility failures, and edges pass; coverage ≥70% |
| 7. Delivery | Package docs and runtime | README, architecture, mapping, Postman, Docker, and walkthrough are usable |

## Acceptance checklist

- [x] DTO → Service → Controller code structure
- [x] Deterministic endpoint and 20-record dataset
- [x] Unit and controller-level tests
- [x] OpenAPI plus request/response examples
- [x] Postman collection with at least three cases
- [x] Container configuration
- [x] Architecture, field mapping, prompt log, and presentation walkthrough
- [ ] Record the supplied walkthrough script as an MP4 and attach it to the submission
