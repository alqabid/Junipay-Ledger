import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Account,
    JournalEntry,
    JournalLine,
    OvaAccount,
    OvaStatementEntry,
    ReconciliationDiscrepancy,
    ReconciliationRun,
)
from app.schemas import DiscrepancyResolveRequest, OvaStatementIngest
from app.services.audit_service import record_audit_log
from app.services.ledger_service import compute_account_balance, ensure_system_accounts


def ingest_ova_statement(db: Session, payload: OvaStatementIngest) -> tuple[OvaStatementEntry, bool]:
    """Idempotently ingest an external OVA bank/telco statement entry."""
    existing = db.scalar(
        select(OvaStatementEntry).where(OvaStatementEntry.external_tx_ref == payload.external_tx_ref)
    )
    if existing:
        return existing, False

    ensure_system_accounts(db, currency=payload.currency)
    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == payload.ova_code))
    if not ova:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"OVA '{payload.ova_code}' not found.")

    entry = OvaStatementEntry(
        ova_account_id=ova.id,
        external_tx_ref=payload.external_tx_ref,
        direction=payload.direction,
        amount=payload.amount,
        running_balance=payload.running_balance,
        currency=payload.currency,
        narration=payload.narration,
        value_date=payload.value_date or datetime.now(timezone.utc),
        reconciliation_status="UNMATCHED",
    )
    db.add(entry)
    db.flush()

    record_audit_log(
        db,
        actor_id="OVA_FEED",
        actor_type="API_CLIENT",
        action="OVA_STATEMENT_INGESTED",
        resource_type="OVA_STATEMENT_ENTRY",
        resource_id=entry.id,
        new_state={
            "external_tx_ref": entry.external_tx_ref,
            "direction": entry.direction,
            "amount": str(entry.amount),
        },
    )
    db.commit()
    db.refresh(entry)
    return entry, True


def compute_external_ova_balance(db: Session, ova_account_id: str) -> Decimal:
    """
    Compute external OVA balance from statement entries:
    Net sum of CREDIT (inflows) minus DEBIT (outflows).
    """
    entries = db.scalars(
        select(OvaStatementEntry).where(OvaStatementEntry.ova_account_id == ova_account_id)
    ).all()
    balance = Decimal("0.0000")
    for e in entries:
        if e.direction == "CREDIT":
            balance += Decimal(e.amount)
        else:
            balance -= Decimal(e.amount)
    return balance


def run_reconciliation(db: Session, *, ova_code: str = "OVA_MAIN", executed_by: str = "ADMIN_USER") -> ReconciliationRun:
    """
    Reconcile Ledger OVA Mirror against External OVA Statement Entries.
    """
    ensure_system_accounts(db)
    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == ova_code))
    if not ova:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"OVA '{ova_code}' not found.")

    ledger_acc = db.scalar(select(Account).where(Account.id == ova.ledger_account_id))
    _, _, ledger_ova_balance = compute_account_balance(db, ledger_acc)
    external_ova_balance = compute_external_ova_balance(db, ova.id)
    variance = ledger_ova_balance - external_ova_balance

    # Load all OVA statement entries and all posted journal entries touching this OVA ledger account
    stmt_entries = db.scalars(
        select(OvaStatementEntry).where(OvaStatementEntry.ova_account_id == ova.id)
    ).all()

    ova_lines = db.scalars(
        select(JournalLine)
        .options(joinedload(JournalLine.journal_entry))
        .where(JournalLine.account_id == ova.ledger_account_id)
    ).all()

    # Map external_reference -> (journal_entry, signed_ova_amount)
    # In ledger, OVA is an ASSET: DEBIT increases (+), CREDIT decreases (-)
    ledger_by_ref: dict[str, tuple[JournalEntry, Decimal]] = {}
    for line in ova_lines:
        je = line.journal_entry
        if not je.external_reference or je.status == "REVERSED" or je.reverses_entry_id is not None:
            continue
        signed_amt = Decimal(line.amount) if line.direction == "DEBIT" else -Decimal(line.amount)
        if je.external_reference in ledger_by_ref:
            prev_je, prev_amt = ledger_by_ref[je.external_reference]
            ledger_by_ref[je.external_reference] = (prev_je, prev_amt + signed_amt)
        else:
            ledger_by_ref[je.external_reference] = (je, signed_amt)

    matched_refs: set[str] = set()
    discrepancies: list[ReconciliationDiscrepancy] = []
    matched_count = 0

    for s_entry in stmt_entries:
        ext_signed = Decimal(s_entry.amount) if s_entry.direction == "CREDIT" else -Decimal(s_entry.amount)
        if s_entry.external_tx_ref in ledger_by_ref:
            je, led_signed = ledger_by_ref[s_entry.external_tx_ref]
            matched_refs.add(s_entry.external_tx_ref)
            if ext_signed == led_signed:
                s_entry.reconciliation_status = "MATCHED"
                s_entry.matched_journal_entry_id = je.id
                matched_count += 1
            else:
                s_entry.reconciliation_status = "DISCREPANCY"
                s_entry.matched_journal_entry_id = je.id
                discrepancies.append(
                    ReconciliationDiscrepancy(
                        discrepancy_type="AMOUNT_MISMATCH",
                        external_tx_ref=s_entry.external_tx_ref,
                        journal_entry_id=je.id,
                        expected_amount=ext_signed,
                        actual_amount=led_signed,
                        difference_amount=led_signed - ext_signed,
                    )
                )
        else:
            s_entry.reconciliation_status = "DISCREPANCY"
            discrepancies.append(
                ReconciliationDiscrepancy(
                    discrepancy_type="MISSING_IN_LEDGER",
                    external_tx_ref=s_entry.external_tx_ref,
                    expected_amount=ext_signed,
                    actual_amount=Decimal("0.0000"),
                    difference_amount=-ext_signed,
                )
            )

    for ref, (je, led_signed) in ledger_by_ref.items():
        if ref not in matched_refs and led_signed != Decimal("0"):
            discrepancies.append(
                ReconciliationDiscrepancy(
                    discrepancy_type="MISSING_IN_OVA",
                    external_tx_ref=ref,
                    journal_entry_id=je.id,
                    expected_amount=Decimal("0.0000"),
                    actual_amount=led_signed,
                    difference_amount=led_signed,
                )
            )

    if variance != Decimal("0") and not discrepancies:
        discrepancies.append(
            ReconciliationDiscrepancy(
                discrepancy_type="BALANCE_VARIANCE",
                expected_amount=external_ova_balance,
                actual_amount=ledger_ova_balance,
                difference_amount=variance,
            )
        )

    run_ref = f"REC-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    run = ReconciliationRun(
        run_reference=run_ref,
        ova_account_id=ova.id,
        currency=ova.currency,
        ledger_ova_balance=ledger_ova_balance,
        external_ova_balance=external_ova_balance,
        variance_amount=variance,
        matched_count=matched_count,
        discrepancy_count=len(discrepancies),
        status="DISCREPANCY_FOUND" if discrepancies else "COMPLETED",
        executed_by=executed_by,
        discrepancies=discrepancies,
    )
    db.add(run)
    db.flush()

    record_audit_log(
        db,
        actor_id=executed_by,
        actor_type="ADMIN_USER",
        action="RECONCILIATION_RUN_EXECUTED",
        resource_type="RECONCILIATION_RUN",
        resource_id=run.id,
        new_state={
            "run_reference": run.run_reference,
            "ledger_ova_balance": str(ledger_ova_balance),
            "external_ova_balance": str(external_ova_balance),
            "variance_amount": str(variance),
            "matched_count": matched_count,
            "discrepancy_count": len(discrepancies),
        },
    )
    db.commit()
    db.refresh(run)
    return run


def resolve_discrepancy(
    db: Session,
    *,
    discrepancy_id: str,
    payload: DiscrepancyResolveRequest,
) -> ReconciliationDiscrepancy:
    disc = db.scalar(select(ReconciliationDiscrepancy).where(ReconciliationDiscrepancy.id == discrepancy_id))
    if not disc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discrepancy not found.")

    prev = {"resolution_status": disc.resolution_status, "resolution_notes": disc.resolution_notes}
    disc.resolution_status = payload.resolution_status
    disc.resolution_notes = payload.resolution_notes
    disc.resolved_by = payload.resolved_by
    if payload.resolution_status == "RESOLVED":
        disc.resolved_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=payload.resolved_by,
        actor_type="ADMIN_USER",
        action="RECONCILIATION_DISCREPANCY_UPDATED",
        resource_type="RECONCILIATION_DISCREPANCY",
        resource_id=disc.id,
        previous_state=prev,
        new_state={
            "resolution_status": disc.resolution_status,
            "resolution_notes": disc.resolution_notes,
        },
    )
    db.commit()
    db.refresh(disc)
    return disc
