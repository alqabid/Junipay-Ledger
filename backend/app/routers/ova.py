from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import OvaLiquidation, OvaStatementEntry
from app.schemas import (
    OvaAccountCreate,
    OvaAccountOut,
    OvaLiquidationCreate,
    OvaLiquidationOut,
    OvaOverviewOut,
    OvaStatementEntryOut,
    OvaStatementIngest,
    OvaSyncRequest,
    OvaTransactionOut,
)
from app.services.ova_service import (
    complete_liquidation,
    create_liquidation,
    create_ova_account,
    get_balance_movement,
    get_ova_overview,
    list_ova_accounts_with_balances,
    list_ova_exceptions,
    list_ova_transactions,
    sync_ova_provider_balance,
)
from app.services.reconciliation_service import ingest_ova_statement

router = APIRouter(prefix="/ova", tags=["OVA Management"])


def _serialize_liq(l: OvaLiquidation) -> OvaLiquidationOut:
    return OvaLiquidationOut(
        id=l.id,
        liquidation_ref=l.liquidation_ref,
        source_ova_id=l.source_ova_id,
        source_ova_code=l.source_ova.code if l.source_ova else None,
        destination_ova_id=l.destination_ova_id,
        destination_ova_code=l.destination_ova.code if l.destination_ova else None,
        currency=l.currency,
        gross_amount=l.gross_amount,
        provider_fee_amount=l.provider_fee_amount,
        net_amount=l.net_amount,
        external_transfer_ref=l.external_transfer_ref,
        status=l.status,
        journal_entry_id=l.journal_entry_id,
        notes=l.notes,
        initiated_by=l.initiated_by,
        completed_by=l.completed_by,
        completed_at=l.completed_at,
        created_at=l.created_at,
    )


@router.get("/overview", response_model=OvaOverviewOut)
def ova_overview(db: Session = Depends(get_db)):
    return get_ova_overview(db)


@router.get("/accounts", response_model=list[OvaAccountOut])
def list_ova_accounts(db: Session = Depends(get_db)):
    return list_ova_accounts_with_balances(db)


@router.post("/accounts", response_model=OvaAccountOut, status_code=status.HTTP_201_CREATED)
def register_ova_account(
    payload: OvaAccountCreate,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    return create_ova_account(db, payload, actor_id=f"{actor.actor_id} ({actor.role})")


@router.post("/accounts/{ova_code}/sync", response_model=OvaAccountOut)
def sync_provider_balance(
    ova_code: str,
    payload: OvaSyncRequest,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    return sync_ova_provider_balance(db, ova_code, payload, actor_id=f"{actor.actor_id} ({actor.role})")


@router.get("/transactions", response_model=list[OvaTransactionOut])
def get_ova_transactions(
    ova_code: Optional[str] = Query(default=None),
    start_date: Optional[datetime] = Query(default=None),
    end_date: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
):
    return list_ova_transactions(db, ova_code=ova_code, start_date=start_date, end_date=end_date)


@router.get("/liquidations", response_model=list[OvaLiquidationOut])
def list_liquidations(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(OvaLiquidation)
        .options(joinedload(OvaLiquidation.source_ova), joinedload(OvaLiquidation.destination_ova))
        .order_by(OvaLiquidation.created_at.desc())
        .limit(100)
    ).all()
    return [_serialize_liq(r) for r in rows]


@router.post("/liquidations", response_model=OvaLiquidationOut, status_code=status.HTTP_201_CREATED)
def initiate_liquidation(
    payload: OvaLiquidationCreate,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    liq = create_liquidation(db, payload, actor_id=f"{actor.actor_id} ({actor.role})")
    loaded = db.scalar(
        select(OvaLiquidation)
        .options(joinedload(OvaLiquidation.source_ova), joinedload(OvaLiquidation.destination_ova))
        .where(OvaLiquidation.id == liq.id)
    )
    return _serialize_liq(loaded)


@router.post("/liquidations/{liquidation_id}/complete", response_model=OvaLiquidationOut)
def finalize_liquidation(
    liquidation_id: str,
    actor: ActorContext = Depends(require_role("FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    liq = complete_liquidation(db, liquidation_id, actor_id=f"{actor.actor_id} ({actor.role})")
    loaded = db.scalar(
        select(OvaLiquidation)
        .options(joinedload(OvaLiquidation.source_ova), joinedload(OvaLiquidation.destination_ova))
        .where(OvaLiquidation.id == liq.id)
    )
    return _serialize_liq(loaded)


@router.get("/statements", response_model=list[OvaStatementEntryOut])
def list_ova_statements(db: Session = Depends(get_db)):
    return db.scalars(
        select(OvaStatementEntry).order_by(OvaStatementEntry.value_date.desc()).limit(200)
    ).all()


@router.post("/statements", response_model=OvaStatementEntryOut, status_code=status.HTTP_201_CREATED)
def ingest_statement(
    payload: OvaStatementIngest,
    _actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    entry, _ = ingest_ova_statement(db, payload)
    return entry


@router.post("/statements/bulk", status_code=status.HTTP_201_CREATED)
def bulk_ingest_statements(
    items: list[OvaStatementIngest],
    _actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    created_count = 0
    duplicate_count = 0
    for item in items:
        _, created = ingest_ova_statement(db, item)
        if created:
            created_count += 1
        else:
            duplicate_count += 1
    return {"ingested": created_count, "duplicates_skipped": duplicate_count}


@router.get("/exceptions")
def get_ova_exceptions(db: Session = Depends(get_db)):
    return list_ova_exceptions(db)


@router.get("/balance-movement")
def ova_balance_movement(ova_code: Optional[str] = Query(default=None), db: Session = Depends(get_db)):
    return get_balance_movement(db, ova_code=ova_code)
