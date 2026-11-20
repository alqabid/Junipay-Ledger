from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import UssdVerification
from app.schemas import JuniPayTransactionEvent
from app.services.audit_service import record_audit_log
from app.services.integration_service import process_junipay_event

router = APIRouter(prefix="/ussd", tags=["USSD & OVA Verification"])


class UssdCreatePayload(BaseModel):
    ussd_session_ref: str = Field(..., min_length=3, max_length=128)
    provider_code: str = Field(..., min_length=2, max_length=64)
    ova_code: str = Field(default="OVA_MAIN", max_length=64)
    external_merchant_id: str = Field(..., min_length=2, max_length=128)
    customer_msisdn_masked: str = Field(..., min_length=4, max_length=32)
    expected_amount: Decimal = Field(..., gt=0)
    fee_amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(default="GHS", max_length=8)


class UssdConfirmPayload(BaseModel):
    ova_dashboard_ref: str = Field(..., min_length=2, max_length=128)
    verified_amount: Decimal = Field(..., gt=0)
    verification_notes: Optional[str] = None


class UssdRejectPayload(BaseModel):
    decision: Literal["REJECTED_MISMATCH", "FLAGGED_SUSPICIOUS"]
    verification_notes: str = Field(..., min_length=3)


@router.get("/verifications")
def list_ussd_verifications(db: Session = Depends(get_db)):
    return db.scalars(
        select(UssdVerification).order_by(UssdVerification.initiated_at.desc()).limit(100)
    ).all()


@router.post("/verifications", status_code=status.HTTP_201_CREATED)
def create_ussd_verification(
    payload: UssdCreatePayload,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(UssdVerification).where(UssdVerification.ussd_session_ref == payload.ussd_session_ref)
    )
    if existing:
        raise HTTPException(status_code=409, detail="USSD session reference already exists.")

    item = UssdVerification(**payload.model_dump(), status="AWAITING_OVA_VERIFICATION")
    db.add(item)
    db.flush()
    record_audit_log(
        db,
        actor_id=f"{actor.actor_id} ({actor.role})",
        actor_type="ADMIN_USER",
        action="USSD_PAYMENT_QUEUED",
        resource_type="USSD_VERIFICATION",
        resource_id=item.id,
        new_state={"ussd_session_ref": item.ussd_session_ref, "expected_amount": str(item.expected_amount)},
    )
    db.commit()
    db.refresh(item)
    return item


@router.post("/verifications/{verification_id}/confirm")
def confirm_ussd_verification(
    verification_id: str,
    payload: UssdConfirmPayload,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    item = db.scalar(select(UssdVerification).where(UssdVerification.id == verification_id))
    if not item:
        raise HTTPException(status_code=404, detail="USSD verification record not found.")
    if item.status != "AWAITING_OVA_VERIFICATION":
        raise HTTPException(status_code=409, detail=f"Record already in status '{item.status}'.")

    if payload.verified_amount != item.expected_amount and not payload.verification_notes:
        raise HTTPException(
            status_code=422,
            detail="Verified amount differs from expected amount; provide verification_notes or reject as mismatch.",
        )

    _, entry = process_junipay_event(
        db,
        JuniPayTransactionEvent(
            idempotency_key=f"ussd:{item.ussd_session_ref}",
            event_type="COLLECTION",
            external_reference=payload.ova_dashboard_ref,
            correlation_id=item.ussd_session_ref,
            external_merchant_id=item.external_merchant_id,
            ova_code=item.ova_code,
            gross_amount=payload.verified_amount,
            fee_amount=item.fee_amount,
            currency=item.currency,
            hold_mode="PENDING",
            description=f"USSD OVA-Verified Collection ({item.provider_code} {item.customer_msisdn_masked})",
            metadata={"channel": f"{item.provider_code} USSD", "ussd_session_ref": item.ussd_session_ref},
        ),
    )

    item.status = "CONFIRMED"
    item.ova_dashboard_ref = payload.ova_dashboard_ref
    item.verified_amount = payload.verified_amount
    item.verification_notes = payload.verification_notes
    item.verified_by = f"{actor.actor_id} ({actor.role})"
    item.verified_at = datetime.now(timezone.utc)
    item.journal_entry_id = entry.id

    record_audit_log(
        db,
        actor_id=item.verified_by,
        actor_type="ADMIN_USER",
        action="USSD_OVA_CONFIRMED",
        resource_type="USSD_VERIFICATION",
        resource_id=item.id,
        new_state={
            "ova_dashboard_ref": item.ova_dashboard_ref,
            "verified_amount": str(item.verified_amount),
            "journal_entry_id": entry.id,
        },
    )
    db.commit()
    db.refresh(item)
    return item


@router.post("/verifications/{verification_id}/reject")
def reject_ussd_verification(
    verification_id: str,
    payload: UssdRejectPayload,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    item = db.scalar(select(UssdVerification).where(UssdVerification.id == verification_id))
    if not item:
        raise HTTPException(status_code=404, detail="USSD verification record not found.")
    if item.status != "AWAITING_OVA_VERIFICATION":
        raise HTTPException(status_code=409, detail=f"Record already in status '{item.status}'.")

    item.status = payload.decision
    item.verification_notes = payload.verification_notes
    item.verified_by = f"{actor.actor_id} ({actor.role})"
    item.verified_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=item.verified_by,
        actor_type="ADMIN_USER",
        action=f"USSD_{payload.decision}",
        resource_type="USSD_VERIFICATION",
        resource_id=item.id,
        new_state={"status": item.status, "notes": payload.verification_notes},
    )
    db.commit()
    db.refresh(item)
    return item
