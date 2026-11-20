import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import Account, OperationalExpense, OvaAccount
from app.schemas import JournalEntryCreate, JournalLineCreate
from app.services.audit_service import record_audit_log
from app.services.ledger_service import compute_account_balance, ensure_system_accounts, post_journal_entry

router = APIRouter(prefix="/expenses", tags=["Operational Expenses & Outflows"])


class ExpenseCreatePayload(BaseModel):
    category: str = Field(..., min_length=2, max_length=64)
    purpose: str = Field(..., min_length=3)
    destination: str = Field(..., min_length=2, max_length=255)
    source_ova_code: str = Field(default="OVA_BANK_SETTLE", max_length=64)
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="GHS", max_length=8)


class ExpenseReviewPayload(BaseModel):
    approval_notes: Optional[str] = None


@router.get("")
def list_expenses(db: Session = Depends(get_db)):
    return db.scalars(
        select(OperationalExpense).order_by(OperationalExpense.created_at.desc()).limit(100)
    ).all()


@router.post("", status_code=status.HTTP_201_CREATED)
def initiate_expense(
    payload: ExpenseCreatePayload,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == payload.source_ova_code))
    if not ova:
        raise HTTPException(status_code=404, detail=f"Source account '{payload.source_ova_code}' not found.")

    ref = f"EXP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
    exp = OperationalExpense(
        expense_ref=ref,
        category=payload.category,
        purpose=payload.purpose,
        destination=payload.destination,
        source_ova_code=payload.source_ova_code,
        amount=payload.amount,
        currency=payload.currency,
        status="PENDING_APPROVAL",
        initiated_by=f"{actor.actor_id} ({actor.role})",
    )
    db.add(exp)
    db.flush()
    record_audit_log(
        db,
        actor_id=exp.initiated_by,
        actor_type="ADMIN_USER",
        action="EXPENSE_INITIATED",
        resource_type="OPERATIONAL_EXPENSE",
        resource_id=exp.id,
        new_state={"expense_ref": exp.expense_ref, "amount": str(exp.amount), "destination": exp.destination},
    )
    db.commit()
    db.refresh(exp)
    return exp


@router.post("/{expense_id}/approve")
def approve_expense(
    expense_id: str,
    payload: ExpenseReviewPayload,
    actor: ActorContext = Depends(require_role("FINANCE_MANAGER", "FINANCE", "MANAGEMENT", "ADMIN")),
    db: Session = Depends(get_db),
):
    exp = db.scalar(select(OperationalExpense).where(OperationalExpense.id == expense_id))
    if not exp:
        raise HTTPException(status_code=404, detail="Expense record not found.")
    if exp.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail=f"Expense already {exp.status}.")

    approver = f"{actor.actor_id} ({actor.role})"
    # Maker-checker enforcement (Admin may override in emergency/single-user setup)
    if exp.initiated_by == approver and actor.role != "ADMIN":
        raise HTTPException(
            status_code=403,
            detail="Maker-checker control: initiator cannot approve their own expense.",
        )

    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == exp.source_ova_code))
    src_gl = db.scalar(select(Account).where(Account.id == ova.ledger_account_id))
    _, _, src_bal = compute_account_balance(db, src_gl)
    if src_bal < exp.amount:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient balance in {exp.source_ova_code} ({src_bal} {exp.currency}).",
        )

    sys_accounts = ensure_system_accounts(db, currency=exp.currency)
    entry, _ = post_journal_entry(
        db,
        JournalEntryCreate(
            idempotency_key=f"exp:{exp.expense_ref}",
            external_reference=exp.expense_ref,
            event_type="EXPENSE",
            description=f"Operational Expense ({exp.category}) -> {exp.destination}: {exp.purpose}",
            currency=exp.currency,
            created_by=approver,
            lines=[
                JournalLineCreate(
                    account_id=sys_accounts["5100"].id,
                    direction="DEBIT",
                    amount=exp.amount,
                    line_memo=f"{exp.category}: {exp.purpose}",
                ),
                JournalLineCreate(
                    account_id=ova.ledger_account_id,
                    direction="CREDIT",
                    amount=exp.amount,
                    line_memo=f"Outflow to {exp.destination}",
                ),
            ],
        ),
        actor_type="ADMIN_USER",
        autocommit=False,
    )

    exp.status = "APPROVED"
    exp.approved_by = approver
    exp.approval_notes = payload.approval_notes
    exp.journal_entry_id = entry.id
    exp.approved_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=approver,
        actor_type="ADMIN_USER",
        action="EXPENSE_APPROVED",
        resource_type="OPERATIONAL_EXPENSE",
        resource_id=exp.id,
        new_state={"status": "APPROVED", "journal_entry_id": entry.id},
    )
    db.commit()
    db.refresh(exp)
    return exp


@router.post("/{expense_id}/reject")
def reject_expense(
    expense_id: str,
    payload: ExpenseReviewPayload,
    actor: ActorContext = Depends(require_role("FINANCE_MANAGER", "FINANCE", "MANAGEMENT", "ADMIN")),
    db: Session = Depends(get_db),
):
    exp = db.scalar(select(OperationalExpense).where(OperationalExpense.id == expense_id))
    if not exp:
        raise HTTPException(status_code=404, detail="Expense record not found.")
    if exp.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail=f"Expense already {exp.status}.")

    exp.status = "REJECTED"
    exp.approved_by = f"{actor.actor_id} ({actor.role})"
    exp.approval_notes = payload.approval_notes
    exp.approved_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=exp.approved_by,
        actor_type="ADMIN_USER",
        action="EXPENSE_REJECTED",
        resource_type="OPERATIONAL_EXPENSE",
        resource_id=exp.id,
        new_state={"status": "REJECTED", "notes": payload.approval_notes},
    )
    db.commit()
    db.refresh(exp)
    return exp
