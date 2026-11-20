import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.models import (
    Account,
    JournalEntry,
    JournalLine,
    OvaAccount,
    OvaLiquidation,
    OvaStatementEntry,
    ReconciliationDiscrepancy,
)
from app.schemas import (
    JournalEntryCreate,
    JournalLineCreate,
    OvaAccountCreate,
    OvaAccountOut,
    OvaLiquidationCreate,
    OvaOverviewOut,
    OvaSyncRequest,
    OvaTransactionOut,
)
from app.services.audit_service import record_audit_log
from app.services.ledger_service import compute_account_balance, ensure_system_accounts, post_journal_entry
from app.services.reconciliation_service import compute_external_ova_balance


def list_ova_accounts_with_balances(db: Session) -> list[OvaAccountOut]:
    ensure_system_accounts(db)
    ovas = db.scalars(
        select(OvaAccount).options(joinedload(OvaAccount.ledger_account)).order_by(OvaAccount.created_at.asc())
    ).all()
    results: list[OvaAccountOut] = []
    for ova in ovas:
        _, _, ledger_bal = compute_account_balance(db, ova.ledger_account)
        # Prefer explicit provider_reported_balance if synced; fallback to statement net sum
        ext_bal = (
            Decimal(ova.provider_reported_balance)
            if ova.provider_reported_balance is not None
            else compute_external_ova_balance(db, ova.id)
        )
        results.append(
            OvaAccountOut(
                id=ova.id,
                code=ova.code,
                provider_code=ova.provider_code,
                provider_name=ova.provider_name,
                account_type=ova.account_type,
                account_number_masked=ova.account_number_masked,
                currency=ova.currency,
                ledger_account_id=ova.ledger_account_id,
                sync_status=ova.sync_status,
                last_synced_at=ova.last_synced_at,
                is_active=ova.is_active,
                ledger_balance=ledger_bal,
                external_reported_balance=ext_bal,
                variance=ledger_bal - ext_bal,
            )
        )
    return results


def create_ova_account(db: Session, payload: OvaAccountCreate, actor_id: str) -> OvaAccountOut:
    existing = db.scalar(select(OvaAccount).where(OvaAccount.code == payload.code))
    if existing:
        raise HTTPException(status_code=409, detail=f"OVA code '{payload.code}' already exists.")

    gl_code = f"10-{payload.code}"
    gl_acc = db.scalar(select(Account).where(Account.code == gl_code))
    if not gl_acc:
        gl_acc = Account(
            code=gl_code,
            name=payload.provider_name,
            account_type="ASSET",
            normal_balance="DEBIT",
            category="OVA_MIRROR",
            currency=payload.currency,
            is_system=True,
            is_active=True,
        )
        db.add(gl_acc)
        db.flush()

    ova = OvaAccount(
        code=payload.code,
        provider_code=payload.provider_code,
        provider_name=payload.provider_name,
        account_type=payload.account_type,
        account_number_masked=payload.account_number_masked,
        currency=payload.currency,
        ledger_account_id=gl_acc.id,
        sync_status="PENDING",
        is_active=True,
    )
    db.add(ova)
    db.flush()

    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="OVA_ACCOUNT_REGISTERED",
        resource_type="OVA_ACCOUNT",
        resource_id=ova.id,
        new_state={"code": ova.code, "provider_code": ova.provider_code, "account_type": ova.account_type},
    )
    db.commit()
    db.refresh(ova)
    return next(a for a in list_ova_accounts_with_balances(db) if a.id == ova.id)


def sync_ova_provider_balance(
    db: Session, ova_code: str, payload: OvaSyncRequest, actor_id: str
) -> OvaAccountOut:
    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == ova_code))
    if not ova:
        raise HTTPException(status_code=404, detail=f"OVA '{ova_code}' not found.")

    prev = {
        "provider_reported_balance": str(ova.provider_reported_balance) if ova.provider_reported_balance is not None else None,
        "sync_status": ova.sync_status,
    }
    ova.provider_reported_balance = payload.provider_reported_balance
    ova.sync_status = payload.sync_status
    ova.last_synced_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="OVA_PROVIDER_BALANCE_SYNCED",
        resource_type="OVA_ACCOUNT",
        resource_id=ova.id,
        previous_state=prev,
        new_state={
            "provider_reported_balance": str(payload.provider_reported_balance),
            "sync_status": payload.sync_status,
        },
    )
    db.commit()
    return next(a for a in list_ova_accounts_with_balances(db) if a.id == ova.id)


def get_ova_overview(db: Session) -> OvaOverviewOut:
    accounts = list_ova_accounts_with_balances(db)
    total_mirrored = sum((a.ledger_balance for a in accounts), Decimal("0.0000"))
    total_reported = sum(
        (a.external_reported_balance for a in accounts if a.external_reported_balance is not None),
        Decimal("0.0000"),
    )

    ova_gl_ids = [a.ledger_account_id for a in accounts]
    total_collections = Decimal("0.0000")
    total_withdrawals = Decimal("0.0000")
    if ova_gl_ids:
        total_collections = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.amount), 0))
                .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
                .where(
                    JournalLine.account_id.in_(ova_gl_ids),
                    JournalLine.direction == "DEBIT",
                    JournalEntry.status == "POSTED",
                )
            )
            or 0
        )
        total_withdrawals = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.amount), 0))
                .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
                .where(
                    JournalLine.account_id.in_(ova_gl_ids),
                    JournalLine.direction == "CREDIT",
                    JournalEntry.status == "POSTED",
                )
            )
            or 0
        )

    sys_accounts = ensure_system_accounts(db)
    _, _, partner_costs = compute_account_balance(db, sys_accounts["5000"])

    unreconciled_stmts = db.scalars(
        select(OvaStatementEntry).where(OvaStatementEntry.reconciliation_status != "MATCHED")
    ).all()
    unreconciled_amount = sum((Decimal(s.amount) for s in unreconciled_stmts), Decimal("0.0000"))
    open_exceptions = (
        db.scalar(
            select(func.count(ReconciliationDiscrepancy.id)).where(
                ReconciliationDiscrepancy.resolution_status != "RESOLVED"
            )
        )
        or 0
    )

    return OvaOverviewOut(
        currency=settings.default_currency,
        total_mirrored_balance=total_mirrored,
        total_provider_reported_balance=total_reported,
        total_variance=total_mirrored - total_reported,
        total_collections=total_collections,
        total_withdrawals=total_withdrawals,
        total_provider_fees=partner_costs,
        unreconciled_amount=unreconciled_amount,
        unreconciled_count=len(unreconciled_stmts),
        open_exceptions=open_exceptions,
        account_count=len(accounts),
    )


def list_ova_transactions(
    db: Session,
    *,
    ova_code: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> list[OvaTransactionOut]:
    ensure_system_accounts(db)
    ova_stmt = select(OvaAccount)
    if ova_code:
        ova_stmt = ova_stmt.where(OvaAccount.code == ova_code)
    ovas = db.scalars(ova_stmt).all()
    if not ovas:
        return []

    ova_by_gl_id = {o.ledger_account_id: o for o in ovas}
    lines = db.scalars(
        select(JournalLine)
        .options(joinedload(JournalLine.journal_entry))
        .where(JournalLine.account_id.in_(list(ova_by_gl_id.keys())))
        .order_by(JournalLine.created_at.asc())
    ).all()

    running_by_ova: dict[str, Decimal] = {o.id: Decimal("0.0000") for o in ovas}
    results: list[OvaTransactionOut] = []

    for line in lines:
        ova = ova_by_gl_id[line.account_id]
        je = line.journal_entry
        delta = Decimal(line.amount) if line.direction == "DEBIT" else -Decimal(line.amount)
        running_by_ova[ova.id] += delta
        bal_after = running_by_ova[ova.id]

        if start_date and je.occurred_at < start_date:
            continue
        if end_date and je.occurred_at > end_date:
            continue

        results.append(
            OvaTransactionOut(
                id=line.id,
                ova_code=ova.code,
                provider_name=ova.provider_name,
                entry_number=je.entry_number,
                external_reference=je.external_reference,
                event_type=je.event_type,
                direction=line.direction,
                amount=Decimal(line.amount),
                running_balance=bal_after,
                currency=line.currency,
                description=line.line_memo or je.description,
                status=je.status,
                occurred_at=je.occurred_at,
            )
        )

    results.reverse()
    return results


def create_liquidation(db: Session, payload: OvaLiquidationCreate, actor_id: str) -> OvaLiquidation:
    if payload.source_ova_code == payload.destination_ova_code:
        raise HTTPException(status_code=422, detail="Source and destination OVA cannot be the same.")

    src = db.scalar(select(OvaAccount).where(OvaAccount.code == payload.source_ova_code))
    dst = db.scalar(select(OvaAccount).where(OvaAccount.code == payload.destination_ova_code))
    if not src or not dst:
        raise HTTPException(status_code=404, detail="Source or destination OVA account not found.")

    if payload.provider_fee_amount > payload.gross_amount:
        raise HTTPException(status_code=422, detail="provider_fee_amount cannot exceed gross_amount.")

    src_gl = db.scalar(select(Account).where(Account.id == src.ledger_account_id))
    _, _, src_bal = compute_account_balance(db, src_gl)
    if src_bal < payload.gross_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient OVA balance ({src_bal} {src.currency}) for liquidation of {payload.gross_amount}.",
        )

    net = payload.gross_amount - payload.provider_fee_amount
    liq_ref = f"LIQ-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    liq = OvaLiquidation(
        liquidation_ref=liq_ref,
        source_ova_id=src.id,
        destination_ova_id=dst.id,
        currency=src.currency,
        gross_amount=payload.gross_amount,
        provider_fee_amount=payload.provider_fee_amount,
        net_amount=net,
        external_transfer_ref=payload.external_transfer_ref,
        status="INITIATED",
        notes=payload.notes,
        initiated_by=actor_id,
    )
    db.add(liq)
    db.flush()

    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="OVA_LIQUIDATION_INITIATED",
        resource_type="OVA_LIQUIDATION",
        resource_id=liq.id,
        new_state={
            "liquidation_ref": liq.liquidation_ref,
            "source": src.code,
            "destination": dst.code,
            "gross_amount": str(liq.gross_amount),
        },
    )
    db.commit()
    db.refresh(liq)
    return liq


def complete_liquidation(db: Session, liquidation_id: str, actor_id: str) -> OvaLiquidation:
    liq = db.scalar(select(OvaLiquidation).where(OvaLiquidation.id == liquidation_id))
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidation record not found.")
    if liq.status == "COMPLETED":
        return liq
    if liq.status not in ("INITIATED", "IN_TRANSIT"):
        raise HTTPException(status_code=409, detail=f"Cannot complete liquidation in status '{liq.status}'.")

    src = db.scalar(select(OvaAccount).where(OvaAccount.id == liq.source_ova_id))
    dst = db.scalar(select(OvaAccount).where(OvaAccount.id == liq.destination_ova_id))
    sys_accounts = ensure_system_accounts(db, currency=liq.currency)

    lines = [
        JournalLineCreate(
            account_id=dst.ledger_account_id,
            direction="DEBIT",
            amount=liq.net_amount,
            line_memo=f"Liquidation inflow from {src.code} ({liq.liquidation_ref})",
        ),
        JournalLineCreate(
            account_id=src.ledger_account_id,
            direction="CREDIT",
            amount=liq.gross_amount,
            line_memo=f"Liquidation sweep to {dst.code} ({liq.liquidation_ref})",
        ),
    ]
    if liq.provider_fee_amount > Decimal("0"):
        lines.append(
            JournalLineCreate(
                account_id=sys_accounts["5000"].id,
                direction="DEBIT",
                amount=liq.provider_fee_amount,
                line_memo=f"Liquidation transfer fee ({liq.liquidation_ref})",
            )
        )

    entry, _ = post_journal_entry(
        db,
        JournalEntryCreate(
            idempotency_key=f"liq:{liq.liquidation_ref}",
            external_reference=liq.external_transfer_ref or liq.liquidation_ref,
            event_type="LIQUIDATION",
            description=f"OVA Liquidation {src.code} -> {dst.code} ({liq.liquidation_ref})",
            currency=liq.currency,
            created_by=actor_id,
            metadata_json={"source_ova": src.code, "destination_ova": dst.code},
            lines=lines,
        ),
        actor_type="ADMIN_USER",
        autocommit=False,
    )

    prev = {"status": liq.status}
    liq.status = "COMPLETED"
    liq.journal_entry_id = entry.id
    liq.completed_by = actor_id
    liq.completed_at = datetime.now(timezone.utc)

    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="OVA_LIQUIDATION_COMPLETED",
        resource_type="OVA_LIQUIDATION",
        resource_id=liq.id,
        previous_state=prev,
        new_state={"status": "COMPLETED", "journal_entry_id": entry.id},
    )
    db.commit()
    db.refresh(liq)
    return liq


def list_ova_exceptions(db: Session) -> dict:
    discrepancies = db.scalars(
        select(ReconciliationDiscrepancy).order_by(ReconciliationDiscrepancy.created_at.desc()).limit(100)
    ).all()
    stale_accounts = db.scalars(
        select(OvaAccount).where(OvaAccount.sync_status.in_(["PENDING", "STALE", "ERROR"]))
    ).all()
    return {
        "discrepancies": [
            {
                "id": d.id,
                "discrepancy_type": d.discrepancy_type,
                "external_tx_ref": d.external_tx_ref,
                "expected_amount": str(d.expected_amount) if d.expected_amount is not None else None,
                "actual_amount": str(d.actual_amount) if d.actual_amount is not None else None,
                "difference_amount": str(d.difference_amount) if d.difference_amount is not None else None,
                "resolution_status": d.resolution_status,
                "resolution_notes": d.resolution_notes,
                "created_at": d.created_at,
            }
            for d in discrepancies
        ],
        "sync_alerts": [
            {
                "ova_code": a.code,
                "provider_name": a.provider_name,
                "sync_status": a.sync_status,
                "last_synced_at": a.last_synced_at,
            }
            for a in stale_accounts
        ],
    }


def get_balance_movement(db: Session, *, ova_code: Optional[str] = None) -> dict:
    """
    Compute Balance Movement Bridge across OVA Asset accounts:
    Opening Balance -> +Collections -> -Withdrawals -> -Provider Fees -> +/-Reversals/Refunds -> Closing Balance.
    """
    ensure_system_accounts(db)
    ova_stmt = select(OvaAccount)
    if ova_code:
        ova_stmt = ova_stmt.where(OvaAccount.code == ova_code)
    ovas = db.scalars(ova_stmt).all()
    gl_ids = [o.ledger_account_id for o in ovas]

    collections = Decimal("0.0000")
    withdrawals = Decimal("0.0000")
    reversals_refunds = Decimal("0.0000")
    liquidations = Decimal("0.0000")

    if gl_ids:
        lines = db.scalars(
            select(JournalLine)
            .options(joinedload(JournalLine.journal_entry))
            .where(JournalLine.account_id.in_(gl_ids))
        ).all()
        for line in lines:
            je = line.journal_entry
            amt = Decimal(line.amount)
            signed = amt if line.direction == "DEBIT" else -amt
            if je.event_type == "COLLECTION":
                collections += signed
            elif je.event_type == "DISBURSEMENT":
                withdrawals += -signed
            elif je.event_type in ("REFUND", "REVERSAL"):
                reversals_refunds += signed
            elif je.event_type == "LIQUIDATION":
                liquidations += signed

    sys_accounts = ensure_system_accounts(db)
    _, _, provider_fees = compute_account_balance(db, sys_accounts["5000"])
    opening = Decimal("0.0000")
    closing = opening + collections - withdrawals + reversals_refunds + liquidations

    return {
        "currency": settings.default_currency,
        "opening_balance": str(opening),
        "collections": str(collections),
        "withdrawals": str(withdrawals),
        "provider_fees": str(provider_fees),
        "reversals_refunds": str(reversals_refunds),
        "liquidations_net": str(liquidations),
        "closing_balance": str(closing),
    }
