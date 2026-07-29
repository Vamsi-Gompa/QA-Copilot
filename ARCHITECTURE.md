# Architecture: Batch to REST

## Before — tightly coupled overnight batch

```mermaid
flowchart LR
  A["Partner flat file"] --> B["Nightly scheduler"]
  B --> C["Monolithic batch program"]
  C --> D[("Legacy claims/member tables")]
  C --> E["Result flat file"]
  E --> F["Downstream consumer next day"]
```

Characteristics: file-level failure, delayed feedback, implicit field
contracts, and business rules mixed with transport and persistence logic.

## After — synchronous, layered REST service

```mermaid
flowchart LR
  A["Client / Postman"] -->|JSON + HTTP| B["Claim Controller"]
  B --> C["Validated Claim DTOs"]
  C --> D["Claim Service"]
  D --> E[("20-row legacy adapter dataset")]
  D --> F["Decision + reason codes"]
  F --> B
  B -->|OpenAPI JSON response| A
  G["pytest unit/API suite"] -. verifies .-> B
  G -. verifies .-> D
```

The controller owns HTTP concerns, DTOs own contract validation and
normalization, and the service owns deterministic business decisions. The JSON
adapter can later be replaced by a repository/database adapter without changing
the public contract or decision rules.

## Operational flow

`Validate → detect duplicate → verify eligibility → enforce limit → approve`

This design enables immediate decisions, isolated unit tests, OpenAPI-driven
integration, machine-readable failure reasons, and incremental replacement of
the legacy data source.
