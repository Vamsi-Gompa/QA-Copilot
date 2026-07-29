from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import List

from pydantic import BaseModel, Field, field_validator


class ClaimDecision(str, Enum):
    APPROVED = "APPROVED"
    DUPLICATE = "DUPLICATE"
    REJECTED = "REJECTED"


class ClaimRequest(BaseModel):
    claim_id: str = Field(min_length=1, max_length=40)
    member_id: str = Field(min_length=1, max_length=40)
    provider_id: str = Field(min_length=1, max_length=40)
    service_date: date
    procedure_code: str = Field(pattern=r"^[A-Z0-9]{3,10}$")
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)

    @field_validator("claim_id", "member_id", "provider_id", "procedure_code", mode="before")
    @classmethod
    def normalize_identifiers(cls, value: str) -> str:
        return value.strip().upper()


class ClaimResponse(BaseModel):
    claim_id: str
    decision: ClaimDecision
    approved_amount: Decimal = Decimal("0.00")
    reason_codes: List[str] = Field(default_factory=list)
    processed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
