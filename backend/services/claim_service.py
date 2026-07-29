import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterable

from dtos.claim_dto import ClaimDecision, ClaimRequest, ClaimResponse


DEFAULT_DATASET = Path(__file__).resolve().parents[1] / "data" / "claims_dataset.json"
MAX_AUTOMATIC_APPROVAL = Decimal("50000.00")


class ClaimService:
    """Deterministic claim adjudication backed by the mock legacy extract."""

    def __init__(self, records: Iterable[Dict[str, Any]]):
        self.records = list(records)

    @classmethod
    def from_json(cls, path: Path = DEFAULT_DATASET) -> "ClaimService":
        with path.open(encoding="utf-8") as dataset:
            return cls(json.load(dataset))

    def adjudicate(self, claim: ClaimRequest) -> ClaimResponse:
        duplicate = self._find_duplicate(claim)
        if duplicate:
            return ClaimResponse(
                claim_id=claim.claim_id,
                decision=ClaimDecision.DUPLICATE,
                reason_codes=["DUPLICATE_CLAIM"],
            )

        member = self._find_member(claim.member_id)
        if member is None:
            return self._rejected(claim, "MEMBER_NOT_FOUND")

        coverage_start = date.fromisoformat(member["coverage_start"])
        coverage_end = date.fromisoformat(member["coverage_end"])
        if not member["eligible"] or not coverage_start <= claim.service_date <= coverage_end:
            return self._rejected(claim, "MEMBER_NOT_ELIGIBLE")

        if claim.amount > MAX_AUTOMATIC_APPROVAL:
            return self._rejected(claim, "AMOUNT_EXCEEDS_AUTO_LIMIT")

        return ClaimResponse(
            claim_id=claim.claim_id,
            decision=ClaimDecision.APPROVED,
            approved_amount=claim.amount.quantize(Decimal("0.01")),
            reason_codes=["ELIGIBLE", "NO_DUPLICATE_FOUND"],
        )

    def _find_member(self, member_id: str) -> Dict[str, Any] | None:
        return next(
            (record for record in self.records if record["legacy_member_no"] == member_id),
            None,
        )

    def _find_duplicate(self, claim: ClaimRequest) -> Dict[str, Any] | None:
        for record in self.records:
            same_id = record["legacy_claim_no"] == claim.claim_id
            same_fingerprint = all(
                (
                    record["legacy_member_no"] == claim.member_id,
                    record["svc_dt"] == claim.service_date.isoformat(),
                    record["proc_cd"] == claim.procedure_code,
                    Decimal(record["billed_amt"]) == claim.amount,
                )
            )
            if same_id or same_fingerprint:
                return record
        return None

    @staticmethod
    def _rejected(claim: ClaimRequest, reason: str) -> ClaimResponse:
        return ClaimResponse(
            claim_id=claim.claim_id,
            decision=ClaimDecision.REJECTED,
            reason_codes=[reason],
        )
