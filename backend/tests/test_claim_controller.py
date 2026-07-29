from fastapi import FastAPI
from fastapi.testclient import TestClient

from controllers.claim_controller import router


app = FastAPI()
app.include_router(router, prefix="/api/claims")
client = TestClient(app)


def test_adjudicate_endpoint_returns_approved_response():
    response = client.post(
        "/api/claims/adjudicate",
        json={
            "claim_id": "CLM-NEW-API",
            "member_id": "MBR-002",
            "provider_id": "PRV-01",
            "service_date": "2026-07-10",
            "procedure_code": "99215",
            "amount": 225.75,
        },
    )
    assert response.status_code == 200
    assert response.json()["decision"] == "APPROVED"
    assert response.json()["approved_amount"] == "225.75"
    assert response.json()["processed_at"].endswith("Z")


def test_adjudicate_endpoint_rejects_malformed_input():
    response = client.post(
        "/api/claims/adjudicate",
        json={"claim_id": "", "amount": 0},
    )
    assert response.status_code == 422
    assert response.json()["detail"]
