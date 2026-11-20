from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import SettlementBatch
from app.schemas import SettlementBatchCreate, SettlementBatchOut
from app.services.settlement_service import create_settlement_batch, settle_batch

router = APIRouter(prefix="/settlements", tags=["Settlement Management"])


def _serialize_batch(b: SettlementBatch) -> SettlementBatchOut:
    return SettlementBatchOut(
        id=b.id,
        batch_reference=b.batch_reference,
        merchant_id=b.merchant_id,
        merchant_name=b.merchant.name if b.merchant else None,
        currency=b.currency,
        gross_amount=b.gross_amount,
        fee_amount=b.fee_amount,
        net_amount=b.net_amount,
        status=b.status,
        settlement_journal_entry_id=b.settlement_journal_entry_id,
        external_payout_ref=b.external_payout_ref,
        scheduled_at=b.scheduled_at,
        settled_at=b.settled_at,
        created_at=b.created_at,
    )


@router.get("", response_model=list[SettlementBatchOut])
def list_settlement_batches(db: Session = Depends(get_db)):
    batches = db.scalars(
        select(SettlementBatch)
        .options(joinedload(SettlementBatch.merchant))
        .order_by(SettlementBatch.created_at.desc())
        .limit(100)
    ).all()
    return [_serialize_batch(b) for b in batches]


@router.post("", response_model=SettlementBatchOut, status_code=status.HTTP_201_CREATED)
def create_batch(
    payload: SettlementBatchCreate,
    _actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    batch = create_settlement_batch(db, payload)
    loaded = db.scalar(
        select(SettlementBatch).options(joinedload(SettlementBatch.merchant)).where(SettlementBatch.id == batch.id)
    )
    return _serialize_batch(loaded)


@router.post("/{batch_id}/settle", response_model=SettlementBatchOut)
def execute_settlement(
    batch_id: str,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    batch = settle_batch(db, batch_id, actor_id=f"{actor.actor_id} ({actor.role})")
    loaded = db.scalar(
        select(SettlementBatch).options(joinedload(SettlementBatch.merchant)).where(SettlementBatch.id == batch.id)
    )
    return _serialize_batch(loaded)
