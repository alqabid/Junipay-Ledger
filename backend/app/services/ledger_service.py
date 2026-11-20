import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.models import Account, JournalEntry, JournalLine, Merchant, OvaAccount
from app.schemas import AccountBalanceOut, JournalEntryCreate, JournalLineCreate
from app.services.audit_service import record_audit_log


SYSTEM_ACCOUNTS = [
    {
        "code": "1010",
        "name": "MTN Collections OVA (Primary)",
        "account_type": "ASSET",
        "normal_balance": "DEBIT",
        "category": "OVA_MIRROR",
    },
    {
        "code": "2900",
        "name": "Reconciliation Suspense & Clearing",
        "account_type": "LIABILITY",
        "normal_balance": "CREDIT",
        "category": "SUSPENSE",
    },
    {
        "code": "3000",
        "name": "JuniPay Capital & Retained Earnings",
        "account_type": "EQUITY",
        "normal_balance": "CREDIT",
        "category": "EQUITY",
    },
    {
        "code": "4000",
        "name": "Transaction & Settlement Fee Revenue",
        "account_type": "REVENUE",
        "normal_balance": "CREDIT",
        "category": "FEE_REVENUE",
    },
    {
        "code": "5000",
        "name": "Payment Partner Processing Costs",
        "account_type": "EXPENSE",
        "normal_balance": "DEBIT",
        "category": "PARTNER_COST",
    },
    {
        "code": "5100",
        "name": "Operational & Administrative Expenses",
        "account_type": "EXPENSE",
        "normal_balance": "DEBIT",
        "category": "OPERATIONAL_EXPENSE",
    },
]


def ensure_system_accounts(db: Session, currency: str = settings.default_currency) -> dict[str, Account]:
    """Ensure core GL accounts and default OVA mirror record exist."""
    existing = {
        acc.code: acc
        for acc in db.scalars(select(Account).where(Account.is_system.is_(True))).all()
    }
    created = False
    for spec in SYSTEM_ACCOUNTS:
        if spec["code"] not in existing:
            acc = Account(
                code=spec["code"],
                name=spec["name"],
                account_type=spec["account_type"],
                normal_balance=spec["normal_balance"],
                category=spec["category"],
                currency=currency,
                is_system=True,
                is_active=True,
            )
            db.add(acc)
            db.flush()
            existing[spec["code"]] = acc
            created = True

    # Ensure default OVA_MAIN mirror account exists
    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == "OVA_MAIN"))
    if not ova:
        ova = OvaAccount(
            code="OVA_MAIN",
            provider_code="MTN_MOMO",
            provider_name="MTN Mobile Money",
            account_type="COLLECTION_OVA",
            account_number_masked="****-MTN-01",
            currency=currency,
            ledger_account_id=existing["1010"].id,
            sync_status="PENDING",
            is_active=True,
        )
        db.add(ova)
        created = True

    if created:
        db.commit()
    return existing


def ensure_merchant_accounts(db: Session, merchant: Merchant) -> tuple[Account, Account]:
    """
    Create or retrieve dedicated sub-ledger liability accounts for a merchant/sub-merchant:
      - MERCHANT_AVAILABLE: settled funds available for payout
      - MERCHANT_PENDING: unsettled funds awaiting settlement batch
    """
    avail_code = f"2100-AVAIL-{merchant.external_merchant_id}"
    pend_code = f"2110-PEND-{merchant.external_merchant_id}"

    avail = db.scalar(select(Account).where(Account.code == avail_code))
    if not avail:
        avail = Account(
            code=avail_code,
            name=f"{merchant.name} - Available Balance",
            account_type="LIABILITY",
            normal_balance="CREDIT",
            category="MERCHANT_AVAILABLE",
            currency=merchant.default_currency,
            merchant_id=merchant.id,
            is_system=False,
        )
        db.add(avail)
        db.flush()

    pend = db.scalar(select(Account).where(Account.code == pend_code))
    if not pend:
        pend = Account(
            code=pend_code,
            name=f"{merchant.name} - Pending Settlement",
            account_type="LIABILITY",
            normal_balance="CREDIT",
            category="MERCHANT_PENDING",
            currency=merchant.default_currency,
            merchant_id=merchant.id,
            is_system=False,
        )
        db.add(pend)
        db.flush()

    return avail, pend


def compute_account_balance(db: Session, account: Account) -> tuple[Decimal, Decimal, Decimal]:
    """Return (debit_total, credit_total, net_balance) respecting account normal_balance."""
    rows = db.execute(
        select(JournalLine.direction, func.coalesce(func.sum(JournalLine.amount), 0))
        .where(JournalLine.account_id == account.id)
        .group_by(JournalLine.direction)
    ).all()

    debits = Decimal("0.0000")
    credits = Decimal("0.0000")
    for direction, total in rows:
        if direction == "DEBIT":
            debits = Decimal(total)
        elif direction == "CREDIT":
            credits = Decimal(total)

    if account.normal_balance == "DEBIT":
        balance = debits - credits
    else:
        balance = credits - debits
    return debits, credits, balance


def list_account_balances(db: Session) -> list[AccountBalanceOut]:
    accounts = db.scalars(select(Account).order_by(Account.code.asc())).all()
    if not accounts:
        return []

    agg_rows = db.execute(
        select(
            JournalLine.account_id,
            JournalLine.direction,
            func.coalesce(func.sum(JournalLine.amount), 0),
        ).group_by(JournalLine.account_id, JournalLine.direction)
    ).all()

    totals: dict[str, dict[str, Decimal]] = {}
    for account_id, direction, total in agg_rows:
        totals.setdefault(account_id, {"DEBIT": Decimal("0"), "CREDIT": Decimal("0")})
        totals[account_id][direction] = Decimal(total)

    result: list[AccountBalanceOut] = []
    for acc in accounts:
        d = totals.get(acc.id, {}).get("DEBIT", Decimal("0.0000"))
        c = totals.get(acc.id, {}).get("CREDIT", Decimal("0.0000"))
        bal = (d - c) if acc.normal_balance == "DEBIT" else (c - d)
        result.append(
            AccountBalanceOut(
                id=acc.id,
                code=acc.code,
                name=acc.name,
                account_type=acc.account_type,
                normal_balance=acc.normal_balance,
                category=acc.category,
                currency=acc.currency,
                merchant_id=acc.merchant_id,
                is_system=acc.is_system,
                is_active=acc.is_active,
                created_at=acc.created_at,
                debit_total=d,
                credit_total=c,
                balance=bal,
            )
        )
    return result


def _generate_entry_number() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    short = uuid.uuid4().hex[:6].upper()
    return f"JRN-{ts}-{short}"


def post_journal_entry(
    db: Session,
    payload: JournalEntryCreate,
    *,
    reverses_entry_id: Optional[str] = None,
    actor_type: str = "SYSTEM",
    autocommit: bool = True,
) -> tuple[JournalEntry, bool]:
    """
    Post an immutable, balanced double-entry journal entry.
    Returns (entry, created_flag). If idempotency_key already exists, returns (existing_entry, False).
    """
    existing = db.scalar(
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .where(JournalEntry.idempotency_key == payload.idempotency_key)
    )
    if existing:
        return existing, False

    if len(payload.lines) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Double-entry journal requires at least 2 lines.",
        )

    debit_sum = sum((line.amount for line in payload.lines if line.direction == "DEBIT"), Decimal("0"))
    credit_sum = sum((line.amount for line in payload.lines if line.direction == "CREDIT"), Decimal("0"))

    if debit_sum <= Decimal("0") or credit_sum <= Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Journal entry must have positive debit and credit totals.",
        )

    if debit_sum != credit_sum:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unbalanced journal entry: debits ({debit_sum}) != credits ({credit_sum}).",
        )

    # Validate all referenced accounts exist & are active
    account_ids = {line.account_id for line in payload.lines}
    accounts = {
        a.id: a for a in db.scalars(select(Account).where(Account.id.in_(account_ids))).all()
    }
    missing = account_ids - set(accounts.keys())
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account(s) not found: {', '.join(sorted(missing))}",
        )

    entry = JournalEntry(
        entry_number=_generate_entry_number(),
        idempotency_key=payload.idempotency_key,
        external_reference=payload.external_reference,
        correlation_id=payload.correlation_id,
        event_type=payload.event_type,
        description=payload.description,
        currency=payload.currency,
        total_amount=debit_sum,
        reverses_entry_id=reverses_entry_id,
        status="POSTED",
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
        created_by=payload.created_by,
        metadata_json=payload.metadata_json,
    )
    db.add(entry)
    db.flush()

    for line in payload.lines:
        db.add(
            JournalLine(
                journal_entry_id=entry.id,
                account_id=line.account_id,
                direction=line.direction,
                amount=line.amount,
                currency=payload.currency,
                merchant_id=line.merchant_id,
                line_memo=line.line_memo,
            )
        )

    record_audit_log(
        db,
        actor_id=payload.created_by,
        actor_type=actor_type,
        action="JOURNAL_POSTED",
        resource_type="JOURNAL_ENTRY",
        resource_id=entry.id,
        correlation_id=payload.correlation_id,
        new_state={
            "entry_number": entry.entry_number,
            "event_type": entry.event_type,
            "total_amount": str(entry.total_amount),
            "currency": entry.currency,
            "reverses_entry_id": reverses_entry_id,
        },
    )

    if autocommit:
        db.commit()
        db.refresh(entry)
    else:
        db.flush()

    loaded = db.scalar(
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .where(JournalEntry.id == entry.id)
    )
    return loaded, True


def reverse_journal_entry(
    db: Session,
    *,
    entry_id: str,
    idempotency_key: str,
    reason: str,
    actor_id: str = "ADMIN_USER",
    autocommit: bool = True,
) -> tuple[JournalEntry, bool]:
    """
    Create an immutable reversal journal entry that flips every debit/credit line
    of the target entry without mutating the original lines.
    """
    existing_rev = db.scalar(
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .where(JournalEntry.idempotency_key == idempotency_key)
    )
    if existing_rev:
        return existing_rev, False

    original = db.scalar(
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines))
        .where(JournalEntry.id == entry_id)
    )
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journal entry not found.")
    if original.status == "REVERSED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Journal entry is already reversed.")
    if original.reverses_entry_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot reverse a reversal entry directly.",
        )

    reversed_lines = [
        JournalLineCreate(
            account_id=line.account_id,
            direction="CREDIT" if line.direction == "DEBIT" else "DEBIT",
            amount=line.amount,
            merchant_id=line.merchant_id,
            line_memo=f"Reversal of {original.entry_number}: {reason}",
        )
        for line in original.lines
    ]

    rev_payload = JournalEntryCreate(
        idempotency_key=idempotency_key,
        external_reference=original.external_reference,
        correlation_id=original.correlation_id,
        event_type="REVERSAL",
        description=f"Reversal of {original.entry_number} ({original.event_type}): {reason}",
        currency=original.currency,
        created_by=actor_id,
        metadata_json={"reversed_entry_number": original.entry_number, "reason": reason},
        lines=reversed_lines,
    )

    rev_entry, created = post_journal_entry(
        db,
        rev_payload,
        reverses_entry_id=original.id,
        actor_type="ADMIN_USER",
        autocommit=False,
    )

    original.status = "REVERSED"
    record_audit_log(
        db,
        actor_id=actor_id,
        actor_type="ADMIN_USER",
        action="JOURNAL_REVERSED",
        resource_type="JOURNAL_ENTRY",
        resource_id=original.id,
        correlation_id=original.correlation_id,
        previous_state={"status": "POSTED"},
        new_state={"status": "REVERSED", "reversal_entry_id": rev_entry.id, "reason": reason},
    )

    if autocommit:
        db.commit()
    else:
        db.flush()

    return rev_entry, created
