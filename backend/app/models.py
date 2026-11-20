import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Merchant(Base):
    __tablename__ = "merchants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    external_merchant_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    parent_merchant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("merchants.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    merchant_type: Mapped[str] = mapped_column(String(32), nullable=False)  # MERCHANT | SUB_MERCHANT
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    settlement_schedule: Mapped[str] = mapped_column(String(64), nullable=False, default="CONFIGURABLE")
    default_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    parent_merchant: Mapped[Optional["Merchant"]] = relationship("Merchant", remote_side=[id], backref="sub_merchants")
    accounts: Mapped[list["Account"]] = relationship("Account", back_populates="merchant")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(String(32), nullable=False)  # ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    normal_balance: Mapped[str] = mapped_column(String(16), nullable=False)  # DEBIT, CREDIT
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    merchant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("merchants.id"), nullable=True, index=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    merchant: Mapped[Optional["Merchant"]] = relationship("Merchant", back_populates="accounts")
    journal_lines: Mapped[list["JournalLine"]] = relationship("JournalLine", back_populates="account")


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (CheckConstraint("total_amount > 0", name="ck_journal_entry_positive_amount"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    entry_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    external_reference: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    correlation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reverses_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="POSTED")  # POSTED | REVERSED
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="SYSTEM")
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    lines: Mapped[list["JournalLine"]] = relationship(
        "JournalLine", back_populates="journal_entry", cascade="all, delete-orphan"
    )
    reverses_entry: Mapped[Optional["JournalEntry"]] = relationship("JournalEntry", remote_side=[id])


class JournalLine(Base):
    __tablename__ = "journal_lines"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_journal_line_positive_amount"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    journal_entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=False, index=True)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)  # DEBIT | CREDIT
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    merchant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("merchants.id"), nullable=True, index=True)
    line_memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    journal_entry: Mapped["JournalEntry"] = relationship("JournalEntry", back_populates="lines")
    account: Mapped["Account"] = relationship("Account", back_populates="journal_lines")


class OvaAccount(Base):
    __tablename__ = "ova_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    provider_code: Mapped[str] = mapped_column(String(64), nullable=False, default="CONFIGURABLE")
    provider_name: Mapped[str] = mapped_column(String(128), nullable=False)
    account_type: Mapped[str] = mapped_column(String(32), nullable=False, default="COLLECTION_OVA")
    account_number_masked: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    ledger_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=False)
    provider_reported_balance: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    ledger_account: Mapped["Account"] = relationship("Account")
    statement_entries: Mapped[list["OvaStatementEntry"]] = relationship("OvaStatementEntry", back_populates="ova_account")


class OvaLiquidation(Base):
    __tablename__ = "ova_liquidations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    liquidation_ref: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    source_ova_id: Mapped[str] = mapped_column(String(36), ForeignKey("ova_accounts.id"), nullable=False)
    destination_ova_id: Mapped[str] = mapped_column(String(36), ForeignKey("ova_accounts.id"), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    provider_fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    external_transfer_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INITIATED")
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    initiated_by: Mapped[str] = mapped_column(String(128), nullable=False, default="OPERATIONS")
    completed_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    source_ova: Mapped["OvaAccount"] = relationship("OvaAccount", foreign_keys=[source_ova_id])
    destination_ova: Mapped["OvaAccount"] = relationship("OvaAccount", foreign_keys=[destination_ova_id])


class OvaStatementEntry(Base):
    __tablename__ = "ova_statement_entries"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_ova_statement_positive_amount"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    ova_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("ova_accounts.id"), nullable=False, index=True)
    external_tx_ref: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)  # CREDIT | DEBIT (from OVA bank/telco view)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    running_balance: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    narration: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    value_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    matched_journal_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("journal_entries.id"), nullable=True
    )
    reconciliation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNMATCHED")

    ova_account: Mapped["OvaAccount"] = relationship("OvaAccount", back_populates="statement_entries")


class SettlementBatch(Base):
    __tablename__ = "settlement_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    batch_reference: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(36), ForeignKey("merchants.id"), nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    settlement_journal_entry_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("journal_entries.id"), nullable=True
    )
    external_payout_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    merchant: Mapped["Merchant"] = relationship("Merchant")
    items: Mapped[list["SettlementItem"]] = relationship(
        "SettlementItem", back_populates="batch", cascade="all, delete-orphan"
    )


class SettlementItem(Base):
    __tablename__ = "settlement_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    batch_id: Mapped[str] = mapped_column(String(36), ForeignKey("settlement_batches.id"), nullable=False, index=True)
    source_journal_entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=False)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    batch: Mapped["SettlementBatch"] = relationship("SettlementBatch", back_populates="items")


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_reference: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    ova_account_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("ova_accounts.id"), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    ledger_ova_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    external_ova_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    variance_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    matched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discrepancy_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="COMPLETED")
    executed_by: Mapped[str] = mapped_column(String(128), nullable=False, default="SYSTEM")
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    discrepancies: Mapped[list["ReconciliationDiscrepancy"]] = relationship(
        "ReconciliationDiscrepancy", back_populates="run", cascade="all, delete-orphan"
    )


class ReconciliationDiscrepancy(Base):
    __tablename__ = "reconciliation_discrepancies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("reconciliation_runs.id"), nullable=False, index=True)
    discrepancy_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_tx_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    expected_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    actual_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    difference_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    resolution_status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    run: Mapped["ReconciliationRun"] = relationship("ReconciliationRun", back_populates="discrepancies")


class IntegrationEvent(Base):
    __tablename__ = "integration_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_reference: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    correlation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    processing_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PROCESSED")
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    correlation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    previous_state: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_state: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class DailyClosing(Base):
    __tablename__ = "daily_closings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    closing_date: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    trial_balance_debits: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    trial_balance_credits: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    is_balanced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    provider_balance_total: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    merchant_obligations_total: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    net_psp_revenue: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    closed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class AdjustmentRequest(Base):
    __tablename__ = "adjustment_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    request_ref: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    debit_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=False)
    credit_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_APPROVAL")
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False)
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class UssdVerification(Base):
    __tablename__ = "ussd_verifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    ussd_session_ref: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    provider_code: Mapped[str] = mapped_column(String(64), nullable=False)
    ova_code: Mapped[str] = mapped_column(String(64), nullable=False)
    external_merchant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    customer_msisdn_masked: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AWAITING_OVA_VERIFICATION")
    ova_dashboard_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    verified_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    verification_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    verified_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    initiated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OperationalExpense(Base):
    __tablename__ = "operational_expenses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    expense_ref: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    destination: Mapped[str] = mapped_column(String(255), nullable=False)
    source_ova_code: Mapped[str] = mapped_column(String(64), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GHS")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_APPROVAL")
    initiated_by: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    approval_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    journal_entry_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("journal_entries.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
