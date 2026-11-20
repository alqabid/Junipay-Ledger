from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import ActorContext, require_role
from app.database import get_db
from app.models import ReconciliationRun
from app.schemas import (
    DiscrepancyResolveRequest,
    ReconciliationDiscrepancyOut,
    ReconciliationRunOut,
    ReconciliationRunRequest,
)
from app.services.reconciliation_service import resolve_discrepancy, run_reconciliation

router = APIRouter(prefix="/reconciliation", tags=["Financial Reconciliation"])


@router.get("/runs", response_model=list[ReconciliationRunOut])
def list_reconciliation_runs(db: Session = Depends(get_db)):
    runs = db.scalars(
        select(ReconciliationRun)
        .options(joinedload(ReconciliationRun.discrepancies))
        .order_by(ReconciliationRun.executed_at.desc())
        .limit(50)
    ).unique().all()
    return runs


@router.post("/run", response_model=ReconciliationRunOut)
def trigger_reconciliation(
    payload: ReconciliationRunRequest,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    run = run_reconciliation(db, ova_code=payload.ova_code, executed_by=f"{actor.actor_id} ({actor.role})")
    return db.scalar(
        select(ReconciliationRun)
        .options(joinedload(ReconciliationRun.discrepancies))
        .where(ReconciliationRun.id == run.id)
    )


@router.patch("/discrepancies/{discrepancy_id}", response_model=ReconciliationDiscrepancyOut)
def update_discrepancy(
    discrepancy_id: str,
    payload: DiscrepancyResolveRequest,
    actor: ActorContext = Depends(require_role("OPERATIONS", "FINANCE", "FINANCE_MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    if payload.resolution_status == "RESOLVED" and actor.role not in ("FINANCE", "FINANCE_MANAGER", "ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only FINANCE, FINANCE_MANAGER, or ADMIN role can mark a discrepancy as RESOLVED.",
        )
    payload.resolved_by = f"{actor.actor_id} ({actor.role})"
    return resolve_discrepancy(db, discrepancy_id=discrepancy_id, payload=payload)
