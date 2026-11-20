from typing import Optional
from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import IntegrationEvent
from app.schemas import IntegrationEventOut, JuniPayTransactionEvent
from app.services.integration_service import process_junipay_event, verify_webhook_signature

router = APIRouter(prefix="/integrations", tags=["JuniPay Integration Contract"])


@router.post("/events", status_code=status.HTTP_202_ACCEPTED)
async def ingest_junipay_event(
    request: Request,
    payload: JuniPayTransactionEvent,
    x_junipay_signature: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Canonical idempotent webhook / REST ingestion endpoint for JuniPay Core.
    """
    raw_body = await request.body()
    verify_webhook_signature(raw_body, x_junipay_signature)
    inbox, entry = process_junipay_event(db, payload)
    return {
        "status": inbox.processing_status,
        "integration_event_id": inbox.id,
        "journal_entry_id": entry.id,
        "entry_number": entry.entry_number,
        "idempotency_key": inbox.idempotency_key,
    }


@router.get("/events", response_model=list[IntegrationEventOut])
def list_integration_events(db: Session = Depends(get_db)):
    return db.scalars(
        select(IntegrationEvent).order_by(IntegrationEvent.received_at.desc()).limit(100)
    ).all()


@router.get("/contract")
def get_integration_contract():
    """
    Exposes the current configurable assumptions and integration contract metadata.
    """
    return {
        "contract_version": "1.0.0",
        "supported_events": ["COLLECTION", "DISBURSEMENT", "REFUND", "REVERSAL"],
        "signature_header": "X-JuniPay-Signature (HMAC-SHA256)",
        "configurable_assumptions": {
            "default_currency": settings.default_currency,
            "settlement_default_hold_mode": settings.settlement_default_hold_mode,
            "fee_source": "Provided per-event by JuniPay Core (defaults to 0 if omitted; never invented)",
            "allow_unsigned_dev_events": settings.allow_unsigned_dev_events,
        },
    }
