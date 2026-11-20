from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import JournalEntry, JournalLine, Merchant
from app.schemas import JournalLineOut, MerchantCreate, MerchantOut, MerchantSummaryOut
from app.services.audit_service import record_audit_log
from app.services.ledger_service import compute_account_balance, ensure_merchant_accounts

router = APIRouter(prefix="/merchants", tags=["Merchants & Sub-Merchants"])


@router.get("", response_model=list[MerchantSummaryOut])
def list_merchants(db: Session = Depends(get_db)):
    merchants = db.scalars(select(Merchant).order_by(Merchant.created_at.asc())).all()
    summaries: list[MerchantSummaryOut] = []

    for m in merchants:
        avail_acc, pend_acc = ensure_merchant_accounts(db, m)
        _, _, avail_bal = compute_account_balance(db, avail_acc)
        _, _, pend_bal = compute_account_balance(db, pend_acc)

        sub_count = (
            db.scalar(select(func.count(Merchant.id)).where(Merchant.parent_merchant_id == m.id)) or 0
        )

        # Aggregate collections, disbursements, refunds from journal lines linked to this merchant
        def _sum_by_event(ev_type: str, direction: str) -> Decimal:
            val = db.scalar(
                select(func.coalesce(func.sum(JournalLine.amount), 0))
                .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
                .where(
                    JournalLine.merchant_id == m.id,
                    JournalLine.account_id.in_([avail_acc.id, pend_acc.id]),
                    JournalLine.direction == direction,
                    JournalEntry.event_type == ev_type,
                    JournalEntry.status == "POSTED",
                )
            )
            return Decimal(val or 0)

        summaries.append(
            MerchantSummaryOut(
                id=m.id,
                external_merchant_id=m.external_merchant_id,
                parent_merchant_id=m.parent_merchant_id,
                name=m.name,
                merchant_type=m.merchant_type,
                status=m.status,
                settlement_schedule=m.settlement_schedule,
                default_currency=m.default_currency,
                created_at=m.created_at,
                available_balance=avail_bal,
                pending_balance=pend_bal,
                total_collections=_sum_by_event("COLLECTION", "CREDIT"),
                total_disbursements=_sum_by_event("DISBURSEMENT", "DEBIT"),
                total_refunds=_sum_by_event("REFUND", "DEBIT"),
                sub_merchant_count=sub_count,
            )
        )
    db.commit()
    return summaries


@router.post("", response_model=MerchantOut, status_code=status.HTTP_201_CREATED)
def create_merchant(
    payload: MerchantCreate,
    _actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(Merchant).where(Merchant.external_merchant_id == payload.external_merchant_id)
    )
    if existing:
        raise HTTPException(status_code=409, detail="external_merchant_id already registered.")

    if payload.merchant_type == "SUB_MERCHANT" and not payload.parent_merchant_id:
        raise HTTPException(status_code=422, detail="SUB_MERCHANT requires parent_merchant_id.")

    if payload.parent_merchant_id:
        parent = db.scalar(select(Merchant).where(Merchant.id == payload.parent_merchant_id))
        if not parent:
            raise HTTPException(status_code=404, detail="Parent merchant not found.")

    merchant = Merchant(**payload.model_dump())
    db.add(merchant)
    db.flush()
    ensure_merchant_accounts(db, merchant)

    record_audit_log(
        db,
        actor_id="ADMIN_USER",
        actor_type="ADMIN_USER",
        action="MERCHANT_REGISTERED",
        resource_type="MERCHANT",
        resource_id=merchant.id,
        new_state={"external_merchant_id": merchant.external_merchant_id, "name": merchant.name},
    )
    db.commit()
    db.refresh(merchant)
    return merchant


@router.get("/{merchant_id}/ledger", response_model=list[JournalLineOut])
def get_merchant_ledger_lines(merchant_id: str, db: Session = Depends(get_db)):
    merchant = db.scalar(select(Merchant).where(Merchant.id == merchant_id))
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found.")

    lines = db.scalars(
        select(JournalLine)
        .options(joinedload(JournalLine.account))
        .where(JournalLine.merchant_id == merchant_id)
        .order_by(JournalLine.created_at.desc())
        .limit(200)
    ).all()

    return [
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
        for l in lines
    ]
