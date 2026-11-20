import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import ActorContext, require_role
from app.config import settings
from app.database import get_db
from app.models import Account, AdjustmentRequest, DailyClosing, Merchant
from app.schemas import JournalEntryCreate, JournalLineCreate
from app.services.audit_service import record_audit_log
from app.services.ledger_service import (
    compute_account_balance,
    ensure_merchant_accounts,
    list_account_balances,
    post_journal_entry,
)

router = APIRouter(prefix="/reports", tags=["Financial Reports"])


@router.get("/financial-summary")
def get_financial_reports(
    period: str = Query(default="all"),
    _actor: ActorContext = Depends(
        require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "MANAGEMENT", "ADMIN")
    ),
    db: Session = Depends(get_db),
):
    """
    Returns Trial Balance, PSP Income Statement (Fee Revenue vs Partner Costs),
    and Merchant Obligations Breakdown for Finance, Operations, and Management.
    """
    accounts = list_account_balances(db)

    trial_balance = [
        {
            "code": a.code,
            "name": a.name,
            "account_type": a.account_type,
            "debit_total": str(a.debit_total),
            "credit_total": str(a.credit_total),
            "net_balance": str(a.balance),
            "currency": a.currency,
        }
        for a in accounts
    ]

    total_debits = sum((a.debit_total for a in accounts), Decimal("0.0000"))
    total_credits = sum((a.credit_total for a in accounts), Decimal("0.0000"))

    fee_revenue = sum((a.balance for a in accounts if a.category == "FEE_REVENUE"), Decimal("0.0000"))
    partner_costs = sum((a.balance for a in accounts if a.category == "PARTNER_COST"), Decimal("0.0000"))
    operational_expenses = sum(
        (a.balance for a in accounts if a.category == "OPERATIONAL_EXPENSE"), Decimal("0.0000")
    )
    ova_balance = sum((a.balance for a in accounts if a.category == "OVA_MIRROR"), Decimal("0.0000"))

    merchants = db.scalars(select(Merchant).order_by(Merchant.name.asc())).all()
    merchant_obligations = []
    for m in merchants:
        avail_acc, pend_acc = ensure_merchant_accounts(db, m)
        _, _, avail = compute_account_balance(db, avail_acc)
        _, _, pend = compute_account_balance(db, pend_acc)
        merchant_obligations.append(
            {
                "external_merchant_id": m.external_merchant_id,
                "name": m.name,
                "merchant_type": m.merchant_type,
                "available_balance": str(avail),
                "pending_balance": str(pend),
                "total_obligation": str(avail + pend),
                "currency": m.default_currency,
            }
        )

    total_obligations = sum((Decimal(m["total_obligation"]) for m in merchant_obligations), Decimal("0.0000"))

    return {
        "currency": settings.default_currency,
        "period": period,
        "trial_balance": {
            "rows": trial_balance,
            "total_debits": str(total_debits),
            "total_credits": str(total_credits),
            "is_balanced": total_debits == total_credits,
        },
        "psp_income_statement": {
            "fee_revenue": str(fee_revenue),
            "partner_processing_costs": str(partner_costs),
            "operational_expenses": str(operational_expenses),
            "net_psp_margin": str(fee_revenue - partner_costs - operational_expenses),
        },
        "custody_position": {
            "ova_mirror_balance": str(ova_balance),
            "total_merchant_obligations": str(total_obligations),
            "coverage_surplus": str(ova_balance - total_obligations),
        },
        "merchant_obligations": merchant_obligations,
    }


class DailyClosePayload(BaseModel):
    closing_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("/daily-closings")
def list_daily_closings(db: Session = Depends(get_db)):
    rows = db.scalars(select(DailyClosing).order_by(DailyClosing.closing_date.desc()).limit(60)).all()
    return rows


@router.post("/daily-close", status_code=status.HTTP_201_CREATED)
def execute_daily_close(
    payload: DailyClosePayload,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    close_date = payload.closing_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = db.scalar(select(DailyClosing).where(DailyClosing.closing_date == close_date))
    if existing:
        raise HTTPException(status_code=409, detail=f"Daily closing for {close_date} already recorded.")

    summary = get_financial_reports(_actor=actor, db=db)
    tb = summary["trial_balance"]
    custody = summary["custody_position"]
    inc = summary["psp_income_statement"]

    closing = DailyClosing(
        closing_date=close_date,
        currency=summary["currency"],
        trial_balance_debits=Decimal(tb["total_debits"]),
        trial_balance_credits=Decimal(tb["total_credits"]),
        is_balanced=tb["is_balanced"],
        provider_balance_total=Decimal(custody["ova_mirror_balance"]),
        merchant_obligations_total=Decimal(custody["total_merchant_obligations"]),
        net_psp_revenue=Decimal(inc["net_psp_margin"]),
        closed_by=f"{actor.actor_id} ({actor.role})",
        notes=payload.notes,
    )
    db.add(closing)
    db.flush()

    record_audit_log(
        db,
        actor_id=f"{actor.actor_id} ({actor.role})",
        actor_type="ADMIN_USER",
        action="DAILY_CLOSING_RECORDED",
        resource_type="DAILY_CLOSING",
        resource_id=closing.id,
        new_state={"closing_date": close_date, "is_balanced": closing.is_balanced},
    )
    db.commit()
    db.refresh(closing)
    return closing


class AdjustmentCreatePayload(BaseModel):
    description: str = Field(..., min_length=3)
    debit_account_id: str
    credit_account_id: str
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="GHS", max_length=8)


class AdjustmentReviewPayload(BaseModel):
    review_notes: Optional[str] = None


@router.get("/adjustments")
def list_adjustments(db: Session = Depends(get_db)):
    return db.scalars(select(AdjustmentRequest).order_by(AdjustmentRequest.created_at.desc()).limit(100)).all()


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
def request_adjustment(
    payload: AdjustmentCreatePayload,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    if payload.debit_account_id == payload.credit_account_id:
        raise HTTPException(status_code=422, detail="Debit and Credit accounts must differ.")

    req = AdjustmentRequest(
        request_ref=f"ADJ-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}",
        description=payload.description,
        currency=payload.currency,
        debit_account_id=payload.debit_account_id,
        credit_account_id=payload.credit_account_id,
        amount=payload.amount,
        status="PENDING_APPROVAL",
        requested_by=f"{actor.actor_id} ({actor.role})",
    )
    db.add(req)
    db.flush()
    record_audit_log(
        db,
        actor_id=req.requested_by,
        actor_type="ADMIN_USER",
        action="ADJUSTMENT_REQUESTED",
        resource_type="ADJUSTMENT_REQUEST",
        resource_id=req.id,
        new_state={"request_ref": req.request_ref, "amount": str(req.amount)},
    )
    db.commit()
    db.refresh(req)
    return req


@router.post("/adjustments/{adj_id}/approve")
def approve_adjustment(
    adj_id: str,
    payload: AdjustmentReviewPayload,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "MANAGEMENT", "ADMIN")),
    db: Session = Depends(get_db),
):
    req = db.scalar(select(AdjustmentRequest).where(AdjustmentRequest.id == adj_id))
    if not req:
        raise HTTPException(status_code=404, detail="Adjustment request not found.")
    if req.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail=f"Request already {req.status}.")

    reviewer = f"{actor.actor_id} ({actor.role})"
    if req.requested_by == reviewer and actor.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Maker-checker control: requester cannot approve their own adjustment.",
        )

    entry, _ = post_journal_entry(
        db,
        JournalEntryCreate(
            idempotency_key=f"adj:{req.request_ref}",
            external_reference=req.request_ref,
            event_type="ADJUSTMENT",
            description=f"Approved Adjustment ({req.request_ref}): {req.description}",
            currency=req.currency,
            created_by=f"{actor.actor_id} ({actor.role})",
            lines=[
                JournalLineCreate(account_id=req.debit_account_id, direction="DEBIT", amount=req.amount),
                JournalLineCreate(account_id=req.credit_account_id, direction="CREDIT", amount=req.amount),
            ],
        ),
        actor_type="ADMIN_USER",
        autocommit=False,
    )

    req.status = "APPROVED"
    req.reviewed_by = f"{actor.actor_id} ({actor.role})"
    req.review_notes = payload.review_notes
    req.journal_entry_id = entry.id
    req.reviewed_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=req.reviewed_by,
        actor_type="ADMIN_USER",
        action="ADJUSTMENT_APPROVED",
        resource_type="ADJUSTMENT_REQUEST",
        resource_id=req.id,
        new_state={"status": "APPROVED", "journal_entry_id": entry.id},
    )
    db.commit()
    db.refresh(req)
    return req


@router.post("/adjustments/{adj_id}/reject")
def reject_adjustment(
    adj_id: str,
    payload: AdjustmentReviewPayload,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "MANAGEMENT", "ADMIN")),
    db: Session = Depends(get_db),
):
    req = db.scalar(select(AdjustmentRequest).where(AdjustmentRequest.id == adj_id))
    if not req:
        raise HTTPException(status_code=404, detail="Adjustment request not found.")
    if req.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail=f"Request already {req.status}.")

    req.status = "REJECTED"
    req.reviewed_by = f"{actor.actor_id} ({actor.role})"
    req.review_notes = payload.review_notes
    req.reviewed_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=req.reviewed_by,
        actor_type="ADMIN_USER",
        action="ADJUSTMENT_REJECTED",
        resource_type="ADJUSTMENT_REQUEST",
        resource_id=req.id,
        new_state={"status": "REJECTED", "notes": payload.review_notes},
    )
    db.commit()
    db.refresh(req)
    return req
