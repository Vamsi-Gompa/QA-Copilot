from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from dtos.claim_dto import ClaimDecision, ClaimRequest
from services.claim_service import ClaimService


@pytest.fixture
def service():
    return ClaimService.from_json()


def make_claim(**overrides):
    values = {
        "claim_id": "clm-new-001",
        "member_id": "mbr-001",
        "provider_id": "prv-01",
        "service_date": "2026-07-01",
        "procedure_code": "99214",
        "amount": "140.50",
    }
    values.update(overrides)
    return ClaimRequest(**values)


def test_eligible_non_duplicate_claim_is_approved(service):
    result = service.adjudicate(make_claim())
    assert result.decision == ClaimDecision.APPROVED
    assert result.approved_amount == Decimal("140.50")
    assert "NO_DUPLICATE_FOUND" in result.reason_codes


def test_duplicate_claim_id_is_detected(service):
    result = service.adjudicate(make_claim(claim_id="CLM-1001"))
    assert result.decision == ClaimDecision.DUPLICATE
    assert result.approved_amount == 0


def test_duplicate_business_fingerprint_is_detected(service):
    result = service.adjudicate(
        make_claim(
            claim_id="CLM-NEW-FINGERPRINT",
            service_date="2026-01-15",
            procedure_code="99213",
            amount="125.50",
        )
    )
    assert result.decision == ClaimDecision.DUPLICATE


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"member_id": "MBR-004", "service_date": "2026-07-01"}, "MEMBER_NOT_ELIGIBLE"),
        ({"member_id": "MBR-404"}, "MEMBER_NOT_FOUND"),
        ({"amount": "50000.01"}, "AMOUNT_EXCEEDS_AUTO_LIMIT"),
    ],
)
def test_eligibility_and_business_failures_are_rejected(service, overrides, reason):
    result = service.adjudicate(make_claim(**overrides))
    assert result.decision == ClaimDecision.REJECTED
    assert result.reason_codes == [reason]


@pytest.mark.parametrize("amount", ["0", "-1.00"])
def test_non_positive_amount_is_invalid(amount):
    with pytest.raises(ValidationError):
        make_claim(amount=amount)


def test_identifiers_are_trimmed_and_normalized():
    claim = make_claim(claim_id=" clm-new-002 ", procedure_code=" a123 ")
    assert claim.claim_id == "CLM-NEW-002"
    assert claim.procedure_code == "A123"
    assert claim.service_date == date(2026, 7, 1)

