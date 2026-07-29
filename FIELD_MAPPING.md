# Legacy-to-DTO Field Mapping

| Legacy field | New DTO field | Type / format | Transformation and validation |
|---|---|---|---|
| `legacy_claim_no` | `claim_id` | string, 1–40 | Trim and uppercase; duplicate key |
| `legacy_member_no` | `member_id` | string, 1–40 | Trim and uppercase; eligibility lookup |
| `legacy_provider_no` | `provider_id` | string, 1–40 | Trim and uppercase |
| `svc_dt` | `service_date` | ISO `YYYY-MM-DD` | Parsed as a calendar date |
| `proc_cd` | `procedure_code` | 3–10 alphanumeric | Trim, uppercase, regex validation |
| `billed_amt` | `amount` | decimal(10,2), > 0 | Decimal parsing; no binary-float calculation |
| `eligible` | response decision input | boolean | Must be true |
| `coverage_start` | response decision input | ISO date | Service date must be on/after |
| `coverage_end` | response decision input | ISO date | Service date must be on/before |
| batch result code | `decision` | enum | `APPROVED`, `DUPLICATE`, or `REJECTED` |
| batch reason | `reason_codes[]` | string array | Stable machine-readable reason codes |
| paid amount | `approved_amount` | decimal | Submitted amount only when approved |
| batch completion timestamp | `processed_at` | UTC timestamp | Generated for each REST response |

Duplicate matching retains the legacy claim number check and adds a business
fingerprint of member, service date, procedure, and billed amount.
