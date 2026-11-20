import hashlib
import hmac
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import IntegrationEvent, JournalEntry, Merchant, OvaAccount
from app.schemas import JournalEntryCreate, JournalLineCreate, JuniPayTransactionEvent
from app.services.audit_service import record_audit_log
from app.services.ledger_service import (
    compute_account_balance,
    ensure_merchant_accounts,
    ensure_system_accounts,
    post_journal_entry,
    reverse_journal_entry,
)


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> None:
    """Verify HMAC-SHA256 signature from JuniPay core unless unsigned dev mode is enabled."""
    if not signature_header:
        if settings.allow_unsigned_dev_events:
            return
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-JuniPay-Signature header.",
        )

    expected = hmac.new(
        settings.webhook_hmac_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    provided = signature_header.removeprefix("sha256=").strip()
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature.",
        )


def process_junipay_event(db: Session, event: JuniPayTransactionEvent) -> tuple[IntegrationEvent, JournalEntry]:
    """
    Idempotently ingest a canonical JuniPay transaction event and post its
    balanced double-entry journal entry.
    """
    existing_event = db.scalar(
        select(IntegrationEvent).where(IntegrationEvent.idempotency_key == event.idempotency_key)
    )
    if existing_event and existing_event.journal_entry_id:
        entry = db.scalar(select(JournalEntry).where(JournalEntry.id == existing_event.journal_entry_id))
        return existing_event, entry

    sys_accounts = ensure_system_accounts(db, currency=event.currency)

    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == event.ova_code))
    if not ova:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OVA account '{event.ova_code}' not configured.",
        )

    merchant = db.scalar(
        select(Merchant).where(Merchant.external_merchant_id == event.external_merchant_id)
    )
    if not merchant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Merchant '{event.external_merchant_id}' not registered in ledger.",
        )

    avail_acc, pend_acc = ensure_merchant_accounts(db, merchant)
    hold_mode = event.hold_mode or settings.settlement_default_hold_mode
    occurred_at = event.occurred_at or datetime.now(timezone.utc)

    inbox = IntegrationEvent(
        idempotency_key=event.idempotency_key,
        event_type=event.event_type,
        external_reference=event.external_reference,
        correlation_id=event.correlation_id,
        payload_json=event.model_dump(mode="json"),
        processing_status="RECEIVED",
    )
    db.add(inbox)
    db.flush()

    try:
        if event.event_type == "COLLECTION":
            net_amount = event.gross_amount - event.fee_amount
            ova_net_inflow = event.gross_amount - event.partner_fee_amount
            target_merchant_acc = pend_acc if hold_mode == "PENDING" else avail_acc
            lines = [
                JournalLineCreate(
                    account_id=ova.ledger_account_id,
                    direction="DEBIT",
                    amount=ova_net_inflow,
                    merchant_id=merchant.id,
                    line_memo=f"OVA collection inflow ({event.external_reference})",
                ),
                JournalLineCreate(
                    account_id=target_merchant_acc.id,
                    direction="CREDIT",
                    amount=net_amount,
                    merchant_id=merchant.id,
                    line_memo=f"Merchant obligation {hold_mode.lower()} credit ({event.external_reference})",
                ),
            ]
            if event.partner_fee_amount > Decimal("0"):
                lines.append(
                    JournalLineCreate(
                        account_id=sys_accounts["5000"].id,
                        direction="DEBIT",
                        amount=event.partner_fee_amount,
                        merchant_id=merchant.id,
                        line_memo=f"Partner processing cost ({event.external_reference})",
                    )
                )
            if event.fee_amount > Decimal("0"):
                lines.append(
                    JournalLineCreate(
                        account_id=sys_accounts["4000"].id,
                        direction="CREDIT",
                        amount=event.fee_amount,
                        merchant_id=merchant.id,
                        line_memo=f"JuniPay PSP fee revenue ({event.external_reference})",
                    )
                )

            entry, _ = post_journal_entry(
                db,
                JournalEntryCreate(
                    idempotency_key=f"evt:{event.idempotency_key}",
                    external_reference=event.external_reference,
                    correlation_id=event.correlation_id,
                    event_type="COLLECTION",
                    description=event.description or f"Collection for {merchant.name} ({event.external_reference})",
                    currency=event.currency,
                    occurred_at=occurred_at,
                    created_by="JUNIPAY_INTEGRATION",
                    metadata_json={**event.metadata, "hold_mode": hold_mode, "ova_code": ova.code},
                    lines=lines,
                ),
                actor_type="API_CLIENT",
                autocommit=False,
            )

        elif event.event_type == "DISBURSEMENT":
            _, _, avail_balance = compute_account_balance(db, avail_acc)
            if avail_balance < event.gross_amount:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Insufficient merchant available balance ({avail_balance} {event.currency}) "
                        f"for disbursement of {event.gross_amount} {event.currency}."
                    ),
                )
            lines = [
                JournalLineCreate(
                    account_id=avail_acc.id,
                    direction="DEBIT",
                    amount=event.gross_amount,
                    merchant_id=merchant.id,
                    line_memo=f"Merchant payout debit ({event.external_reference})",
                ),
                JournalLineCreate(
                    account_id=ova.ledger_account_id,
                    direction="CREDIT",
                    amount=event.gross_amount,
                    merchant_id=merchant.id,
                    line_memo=f"OVA disbursement outflow ({event.external_reference})",
                ),
            ]
            entry, _ = post_journal_entry(
                db,
                JournalEntryCreate(
                    idempotency_key=f"evt:{event.idempotency_key}",
                    external_reference=event.external_reference,
                    correlation_id=event.correlation_id,
                    event_type="DISBURSEMENT",
                    description=event.description or f"Disbursement for {merchant.name} ({event.external_reference})",
                    currency=event.currency,
                    occurred_at=occurred_at,
                    created_by="JUNIPAY_INTEGRATION",
                    metadata_json={**event.metadata, "ova_code": ova.code},
                    lines=lines,
                ),
                actor_type="API_CLIENT",
                autocommit=False,
            )

        elif event.event_type == "REFUND":
            net_refund = event.gross_amount - event.fee_amount
            source_acc = pend_acc if hold_mode == "PENDING" else avail_acc
            _, _, source_bal = compute_account_balance(db, source_acc)
            if source_bal < net_refund:
                # Fallback to available if pending doesn't cover it
                alt_acc = avail_acc if source_acc.id == pend_acc.id else pend_acc
                _, _, alt_bal = compute_account_balance(db, alt_acc)
                if alt_bal >= net_refund:
                    source_acc = alt_acc
                else:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Insufficient merchant balance for refund of {net_refund} {event.currency}.",
                    )

            lines = [
                JournalLineCreate(
                    account_id=source_acc.id,
                    direction="DEBIT",
                    amount=net_refund,
                    merchant_id=merchant.id,
                    line_memo=f"Refund debit ({event.external_reference})",
                ),
                JournalLineCreate(
                    account_id=ova.ledger_account_id,
                    direction="CREDIT",
                    amount=event.gross_amount,
                    merchant_id=merchant.id,
                    line_memo=f"OVA refund outflow ({event.external_reference})",
                ),
            ]
            if event.fee_amount > Decimal("0"):
                lines.append(
                    JournalLineCreate(
                        account_id=sys_accounts["4000"].id,
                        direction="DEBIT",
                        amount=event.fee_amount,
                        merchant_id=merchant.id,
                        line_memo=f"Fee refund adjustment ({event.external_reference})",
                    )
                )

            entry, _ = post_journal_entry(
                db,
                JournalEntryCreate(
                    idempotency_key=f"evt:{event.idempotency_key}",
                    external_reference=event.external_reference,
                    correlation_id=event.correlation_id,
                    event_type="REFUND",
                    description=event.description or f"Refund for {merchant.name} ({event.external_reference})",
                    currency=event.currency,
                    occurred_at=occurred_at,
                    created_by="JUNIPAY_INTEGRATION",
                    metadata_json={**event.metadata, "ova_code": ova.code},
                    lines=lines,
                ),
                actor_type="API_CLIENT",
                autocommit=False,
            )

        elif event.event_type == "REVERSAL":
            target_id = event.target_entry_id
            if not target_id:
                target = db.scalar(
                    select(JournalEntry).where(
                        JournalEntry.external_reference == event.external_reference,
                        JournalEntry.status == "POSTED",
                    )
                )
                if not target:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"No posted journal entry found for reference '{event.external_reference}'.",
                    )
                target_id = target.id

            entry, _ = reverse_journal_entry(
                db,
                entry_id=target_id,
                idempotency_key=f"evt:{event.idempotency_key}",
                reason=event.description or f"Reversal event {event.external_reference}",
                actor_id="JUNIPAY_INTEGRATION",
                autocommit=False,
            )

        else:
            raise HTTPException(status_code=422, detail=f"Unsupported event_type: {event.event_type}")

        inbox.processing_status = "PROCESSED"
        inbox.journal_entry_id = entry.id
        record_audit_log(
            db,
            actor_id="JUNIPAY_INTEGRATION",
            actor_type="API_CLIENT",
            action="INTEGRATION_EVENT_PROCESSED",
            resource_type="INTEGRATION_EVENT",
            resource_id=inbox.id,
            correlation_id=event.correlation_id,
            new_state={"event_type": event.event_type, "journal_entry_id": entry.id},
        )
        db.commit()
        db.refresh(inbox)
        return inbox, entry

    except HTTPException as exc:
        db.rollback()
        inbox_fail = IntegrationEvent(
            idempotency_key=event.idempotency_key,
            event_type=event.event_type,
            external_reference=event.external_reference,
            correlation_id=event.correlation_id,
            payload_json=event.model_dump(mode="json"),
            processing_status="FAILED",
            error_message=str(exc.detail),
        )
        db.add(inbox_fail)
        db.commit()
        raise
