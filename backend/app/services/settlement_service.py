import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant, SettlementBatch
from app.schemas import JournalEntryCreate, JournalLineCreate, SettlementBatchCreate
from app.services.audit_service import record_audit_log
from app.services.ledger_service import (
    compute_account_balance,
    ensure_merchant_accounts,
    ensure_system_accounts,
    post_journal_entry,
)


def create_settlement_batch(db: Session, payload: SettlementBatchCreate) -> SettlementBatch:
    """
    Create a PENDING settlement batch for a merchant's current pending balance.
    """
    merchant = db.scalar(
        select(Merchant).where(Merchant.external_merchant_id == payload.external_merchant_id)
    )
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    _, pend_acc = ensure_merchant_accounts(db, merchant)
    _, _, pending_balance = compute_account_balance(db, pend_acc)

    if pending_balance <= Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Merchant '{merchant.name}' has no pending settlement balance ({pending_balance}).",
        )

    if payload.fee_amount > pending_balance:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Settlement fee_amount cannot exceed pending balance.",
        )

    net_amount = pending_balance - payload.fee_amount
    batch_ref = f"STL-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"

    batch = SettlementBatch(
        batch_reference=batch_ref,
        merchant_id=merchant.id,
        currency=payload.currency,
        gross_amount=pending_balance,
        fee_amount=payload.fee_amount,
        net_amount=net_amount,
        status="PENDING",
        external_payout_ref=payload.external_payout_ref,
        scheduled_at=datetime.now(timezone.utc),
    )
    db.add(batch)
    db.flush()

    record_audit_log(
        db,
        actor_id="FINANCE_OPS",
        actor_type="ADMIN_USER",
        action="SETTLEMENT_BATCH_CREATED",
        resource_type="SETTLEMENT_BATCH",
        resource_id=batch.id,
        new_state={
            "batch_reference": batch.batch_reference,
            "gross_amount": str(batch.gross_amount),
            "fee_amount": str(batch.fee_amount),
            "net_amount": str(batch.net_amount),
            "status": batch.status,
        },
    )
    db.commit()
    db.refresh(batch)
    return batch


def settle_batch(db: Session, batch_id: str, actor_id: str = "FINANCE_OPS") -> SettlementBatch:
    """
    Execute settlement for a PENDING batch:
      - Debit MERCHANT_PENDING = gross_amount
      - Credit MERCHANT_AVAILABLE = net_amount
      - Credit FEE_REVENUE = fee_amount (if > 0)
    """
    batch = db.scalar(select(SettlementBatch).where(SettlementBatch.id == batch_id))
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Settlement batch not found.")
    if batch.status == "SETTLED":
        return batch
    if batch.status not in ("PENDING", "PROCESSING"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot settle batch in status '{batch.status}'.",
        )

    merchant = db.scalar(select(Merchant).where(Merchant.id == batch.merchant_id))
    sys_accounts = ensure_system_accounts(db, currency=batch.currency)
    avail_acc, pend_acc = ensure_merchant_accounts(db, merchant)

    _, _, current_pending = compute_account_balance(db, pend_acc)
    if current_pending < batch.gross_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Pending balance ({current_pending}) is lower than batch gross ({batch.gross_amount}).",
        )

    lines = [
        JournalLineCreate(
            account_id=pend_acc.id,
            direction="DEBIT",
            amount=batch.gross_amount,
            merchant_id=merchant.id,
            line_memo=f"Release pending funds for batch {batch.batch_reference}",
        ),
        JournalLineCreate(
            account_id=avail_acc.id,
            direction="CREDIT",
            amount=batch.net_amount,
            merchant_id=merchant.id,
            line_memo=f"Credit available balance from batch {batch.batch_reference}",
        ),
    ]
    if batch.fee_amount > Decimal("0"):
        lines.append(
            JournalLineCreate(
                account_id=sys_accounts["4000"].id,
                direction="CREDIT",
                amount=batch.fee_amount,
                merchant_id=merchant.id,
                line_memo=f"Settlement fee for batch {batch.batch_reference}",
            )
        )

    entry, _ = post_journal_entry(
        db,
        JournalEntryCreate(
            idempotency_key=f"stl:{batch.batch_reference}",
            external_reference=batch.batch_reference,
            event_type="SETTLEMENT",
            description=f"Settlement batch {batch.batch_reference} for {merchant.name}",
            currency=batch.currency,
            created_by=actor_id,
            metadata_json={"batch_id": batch.id, "external_payout_ref": batch.external_payout_ref},
            lines=lines,
        ),
        actor_type="ADMIN_USER",
        autocommit=False,
    )

    prev_status = batch.status
    batch.status = "SETTLED"
    batch.settlement_journal_entry_id = entry.id
    batch.settled_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="SETTLEMENT_BATCH_SETTLED",
        resource_type="SETTLEMENT_BATCH",
        resource_id=batch.id,
        previous_state={"status": prev_status},
        new_state={"status": "SETTLED", "settlement_journal_entry_id": entry.id},
    )
    db.commit()
    db.refresh(batch)
    return batch
