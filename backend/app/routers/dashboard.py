from decimal import Decimal
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import (
    Account,
    JournalEntry,
    JournalLine,
    Merchant,
    OvaAccount,
    ReconciliationDiscrepancy,
    SettlementBatch,
    UssdVerification,
)
from app.schemas import DashboardSummaryOut
from app.services.ledger_service import compute_account_balance, ensure_system_accounts
from app.services.ova_service import list_ova_accounts_with_balances
from app.services.reconciliation_service import compute_external_ova_balance
from app.services.seed_service import seed_sample_data

router = APIRouter(tags=["Dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummaryOut)
def get_dashboard_summary(db: Session = Depends(get_db)):
    sys_accounts = ensure_system_accounts(db, currency=settings.default_currency)

    def _sum_events(event_type: str) -> Decimal:
        val = db.scalar(
            select(func.coalesce(func.sum(JournalEntry.total_amount), 0)).where(
                JournalEntry.event_type == event_type,
                JournalEntry.status == "POSTED",
            )
        )
        return Decimal(val or 0)

    total_collections = _sum_events("COLLECTION")
    total_disbursements = _sum_events("DISBURSEMENT")
    total_refunds = _sum_events("REFUND")

    _, _, fee_rev = compute_account_balance(db, sys_accounts["4000"])
    _, _, partner_costs = compute_account_balance(db, sys_accounts["5000"])
    _, _, op_expenses = compute_account_balance(db, sys_accounts["5100"])
    _, _, ova_ledger_balance = compute_account_balance(db, sys_accounts["1010"])

    all_ova_accounts = list_ova_accounts_with_balances(db)
    total_provider_ovas = sum(
        (a.ledger_balance for a in all_ova_accounts if a.account_type in ("COLLECTION_OVA", "PAYOUT_OVA")),
        Decimal("0.0000"),
    )
    total_bank_bals = sum(
        (a.ledger_balance for a in all_ova_accounts if a.account_type == "SETTLEMENT_ACCOUNT"),
        Decimal("0.0000"),
    )

    avail_accounts = db.scalars(select(Account).where(Account.category == "MERCHANT_AVAILABLE")).all()
    pend_accounts = db.scalars(select(Account).where(Account.category == "MERCHANT_PENDING")).all()

    total_avail = sum((compute_account_balance(db, a)[2] for a in avail_accounts), Decimal("0.0000"))
    total_pend = sum((compute_account_balance(db, a)[2] for a in pend_accounts), Decimal("0.0000"))
    total_merchant_obligations = total_avail + total_pend
    net_psp_revenue = fee_rev - partner_costs - op_expenses
    ova_coverage_surplus = (total_provider_ovas + total_bank_bals) - total_merchant_obligations

    ova = db.scalar(select(OvaAccount).where(OvaAccount.code == "OVA_MAIN"))
    ova_ext_bal = compute_external_ova_balance(db, ova.id) if ova else None
    ova_var = (ova_ledger_balance - ova_ext_bal) if ova_ext_bal is not None else None

    open_discrepancies = (
        db.scalar(
            select(func.count(ReconciliationDiscrepancy.id)).where(
                ReconciliationDiscrepancy.resolution_status != "RESOLVED"
            )
        )
        or 0
    )
    pending_batches = (
        db.scalar(
            select(func.count(SettlementBatch.id)).where(
                SettlementBatch.status.in_(["PENDING", "PROCESSING"])
            )
        )
        or 0
    )
    pending_ussd = (
        db.scalar(
            select(func.count(UssdVerification.id)).where(
                UssdVerification.status == "AWAITING_OVA_VERIFICATION"
            )
        )
        or 0
    )

    tb_debits = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(JournalLine.amount), 0)).where(JournalLine.direction == "DEBIT")
        )
        or 0
    )
    tb_credits = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(JournalLine.amount), 0)).where(JournalLine.direction == "CREDIT")
        )
        or 0
    )

    has_sample = (
        db.scalar(select(func.count(Merchant.id)).where(Merchant.external_merchant_id.like("%-SAMPLE-%"))) or 0
    ) > 0

    return DashboardSummaryOut(
        currency=settings.default_currency,
        total_collections=total_collections,
        total_disbursements=total_disbursements,
        total_refunds=total_refunds,
        total_fee_revenue=fee_rev,
        total_partner_costs=partner_costs,
        total_operational_expenses=op_expenses,
        net_psp_revenue=net_psp_revenue,
        total_available_balance=total_avail,
        total_pending_settlement=total_pend,
        total_merchant_obligations=total_merchant_obligations,
        ova_ledger_balance=ova_ledger_balance,
        total_provider_ova_balances=total_provider_ovas,
        total_bank_balances=total_bank_bals,
        ova_external_balance=ova_ext_bal,
        ova_variance=ova_var,
        ova_coverage_surplus=ova_coverage_surplus,
        open_discrepancies=open_discrepancies,
        pending_settlement_batches=pending_batches,
        pending_ussd_verifications=pending_ussd,
        trial_balance_debits=tb_debits,
        trial_balance_credits=tb_credits,
        is_balanced=(tb_debits == tb_credits),
        has_sample_data=has_sample,
    )


@router.post("/demo/seed")
def trigger_sample_seed(db: Session = Depends(get_db)):
    return seed_sample_data(db)
