from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import Account, JournalEntry, JournalLine
from app.schemas import (
    AccountBalanceOut,
    AccountCreate,
    AccountOut,
    JournalEntryCreate,
    JournalEntryOut,
    JournalLineOut,
    ReversalRequest,
)
from app.services.ledger_service import (
    ensure_system_accounts,
    list_account_balances,
    post_journal_entry,
    reverse_journal_entry,
)

router = APIRouter(prefix="/ledger", tags=["General Ledger"])


def _serialize_entry(entry: JournalEntry) -> JournalEntryOut:
    lines_out = [
        JournalLineOut(
            id=l.id,
            account_id=l.account_id,
            account_code=l.account.code if l.account else None,
            account_name=l.account.name if l.account else None,
            direction=l.direction,
            amount=l.amount,
            currency=l.currency,
            merchant_id=l.merchant_id,
            line_memo=l.line_memo,
            created_at=l.created_at,
        )
        for l in entry.lines
    ]
    return JournalEntryOut(
        id=entry.id,
        entry_number=entry.entry_number,
        idempotency_key=entry.idempotency_key,
        external_reference=entry.external_reference,
        correlation_id=entry.correlation_id,
        event_type=entry.event_type,
        description=entry.description,
        currency=entry.currency,
        total_amount=entry.total_amount,
        reverses_entry_id=entry.reverses_entry_id,
        status=entry.status,
        occurred_at=entry.occurred_at,
        posted_at=entry.posted_at,
        created_by=entry.created_by,
        metadata_json=entry.metadata_json,
        lines=lines_out,
    )


@router.get("/accounts", response_model=list[AccountBalanceOut])
def get_accounts(db: Session = Depends(get_db)):
    ensure_system_accounts(db)
    return list_account_balances(db)


@router.get("/summary")
def get_ledger_summary(db: Session = Depends(get_db)):
    """
    Live Accounting Equation & Trial Balance proof by currency:
    Assets == Liabilities + Equity + (Revenue - Expenses), and Total Debits == Total Credits.
    """
    from decimal import Decimal

    ensure_system_accounts(db)
    accounts = list_account_balances(db)

    by_currency: dict[str, dict[str, Decimal]] = {}
    for a in accounts:
        c = by_currency.setdefault(
            a.currency,
            {
                "ASSET": Decimal("0"),
                "LIABILITY": Decimal("0"),
                "EQUITY": Decimal("0"),
                "REVENUE": Decimal("0"),
                "EXPENSE": Decimal("0"),
                "DEBITS": Decimal("0"),
                "CREDITS": Decimal("0"),
            },
        )
        c[a.account_type] += Decimal(a.balance)
        c["DEBITS"] += Decimal(a.debit_total)
        c["CREDITS"] += Decimal(a.credit_total)

    currencies = []
    for ccy, vals in by_currency.items():
        net_income = vals["REVENUE"] - vals["EXPENSE"]
        right_side = vals["LIABILITY"] + vals["EQUITY"] + net_income
        currencies.append(
            {
                "currency": ccy,
                "assets": str(vals["ASSET"]),
                "liabilities": str(vals["LIABILITY"]),
                "equity": str(vals["EQUITY"]),
                "revenue": str(vals["REVENUE"]),
                "expenses": str(vals["EXPENSE"]),
                "net_income": str(net_income),
                "total_debits": str(vals["DEBITS"]),
                "total_credits": str(vals["CREDITS"]),
                "is_trial_balanced": vals["DEBITS"] == vals["CREDITS"],
                "is_equation_balanced": vals["ASSET"] == right_side,
            }
        )

    return {"currencies": currencies, "account_count": len(accounts)}


@router.get("/accounts/{account_id}/transactions")
def get_account_transactions(account_id: str, db: Session = Depends(get_db)):
    """Account drill-down: balance, debit/credit movements, and running balance."""
    from decimal import Decimal
    from app.services.ledger_service import compute_account_balance

    acc = db.scalar(select(Account).where(Account.id == account_id))
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found.")

    debits, credits, balance = compute_account_balance(db, acc)
    lines = db.scalars(
        select(JournalLine)
        .options(joinedload(JournalLine.journal_entry))
        .where(JournalLine.account_id == account_id)
        .order_by(JournalLine.created_at.asc())
    ).all()

    running = Decimal("0.0000")
    history = []
    for l in lines:
        je = l.journal_entry
        amt = Decimal(l.amount)
        if acc.normal_balance == "DEBIT":
            running += amt if l.direction == "DEBIT" else -amt
        else:
            running += amt if l.direction == "CREDIT" else -amt
        history.append(
            {
                "id": l.id,
                "entry_id": je.id,
                "entry_number": je.entry_number,
                "event_type": je.event_type,
                "external_reference": je.external_reference,
                "direction": l.direction,
                "amount": str(amt),
                "running_balance": str(running),
                "currency": l.currency,
                "description": l.line_memo or je.description,
                "status": je.status,
                "occurred_at": je.occurred_at,
            }
        )
    history.reverse()
    return {
        "account": {
            "id": acc.id,
            "code": acc.code,
            "name": acc.name,
            "account_type": acc.account_type,
            "normal_balance": acc.normal_balance,
            "category": acc.category,
            "currency": acc.currency,
            "debit_total": str(debits),
            "credit_total": str(credits),
            "balance": str(balance),
        },
        "transactions": history,
    }


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate,
    _actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    existing = db.scalar(select(Account).where(Account.code == payload.code))
    if existing:
        raise HTTPException(status_code=409, detail=f"Account code '{payload.code}' already exists.")
    acc = Account(**payload.model_dump(), is_system=False, is_active=True)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


@router.get("/entries", response_model=list[JournalEntryOut])
def list_journal_entries(
    event_type: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = (
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .order_by(JournalEntry.posted_at.desc())
        .limit(limit)
    )
    if event_type:
        stmt = stmt.where(JournalEntry.event_type == event_type)
    entries = db.scalars(stmt).unique().all()
    return [_serialize_entry(e) for e in entries]


@router.post("/entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def create_journal_entry(
    payload: JournalEntryCreate,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    payload.created_by = f"{actor.actor_id} ({actor.role})"
    entry, _ = post_journal_entry(db, payload, actor_type="ADMIN_USER")
    return _serialize_entry(entry)


@router.post("/entries/{entry_id}/reverse", response_model=JournalEntryOut)
def reverse_entry(
    entry_id: str,
    payload: ReversalRequest,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    rev_entry, _ = reverse_journal_entry(
        db,
        entry_id=entry_id,
        idempotency_key=payload.idempotency_key,
        reason=payload.reason,
        actor_id=f"{actor.actor_id} ({actor.role})",
    )
    return _serialize_entry(rev_entry)
