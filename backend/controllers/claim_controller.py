from fastapi import APIRouter, Depends

from dtos.claim_dto import ClaimRequest, ClaimResponse
from services.claim_service import ClaimService


router = APIRouter()


def get_claim_service() -> ClaimService:
    return ClaimService.from_json()


@router.post(
    "/adjudicate",
    response_model=ClaimResponse,
    summary="Validate and adjudicate a medical claim",
)
def adjudicate_claim(
    claim: ClaimRequest,
    service: ClaimService = Depends(get_claim_service),
) -> ClaimResponse:
    return service.adjudicate(claim)

