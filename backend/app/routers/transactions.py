from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import JournalEntry, JournalLine, OvaStatementEntry

router = APIRouter(prefix="/transactions", tags=["Transaction Monitoring"])


@router.get("")
def list_transactions(
    search: Optional[str] = Query(default=None),
    event_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=150, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Transaction Monitoring feed with payment channel, status, references,
    and reconciliation lifecycle status.
    """
    stmt = (
        select(JournalEntry)
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .order_by(JournalEntry.occurred_at.desc())
        .limit(limit)
    )
    if event_type:
        stmt = stmt.where(JournalEntry.event_type == event_type)
    if status:
        stmt = stmt.where(JournalEntry.status == status)

    entries = db.scalars(stmt).unique().all()

    # Map matched OVA statements by external_tx_ref
    stmts = db.scalars(select(OvaStatementEntry)).all()
    recon_by_ref = {s.external_tx_ref: s.reconciliation_status for s in stmts}

    results = []
    for e in entries:
        meta = e.metadata_json or {}
        channel = meta.get("channel") or meta.get("rail") or meta.get("ova_code") or "CORE"
        if search:
            q = search.lower()
            hay = f"{e.entry_number} {e.external_reference or ''} {e.correlation_id or ''} {e.description} {channel}".lower()
            if q not in hay:
                continue

        recon_status = recon_by_ref.get(e.external_reference or "", "N/A")
        results.append(
            {
                "id": e.id,
                "entry_number": e.entry_number,
                "external_reference": e.external_reference,
                "correlation_id": e.correlation_id,
                "event_type": e.event_type,
                "channel": channel,
                "description": e.description,
                "currency": e.currency,
                "total_amount": str(e.total_amount),
                "status": e.status,
                "reverses_entry_id": e.reverses_entry_id,
                "reconciliation_status": recon_status,
                "occurred_at": e.occurred_at,
                "posted_at": e.posted_at,
                "created_by": e.created_by,
                "lines": [
                    {
                        "id": l.id,
                        "account_code": l.account.code if l.account else None,
                        "account_name": l.account.name if l.account else None,
                        "direction": l.direction,
                        "amount": str(l.amount),
                        "line_memo": l.line_memo,
                    }
                    for l in e.lines
                ],
            }
        )
    return results
