from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Accounts ---
class AccountCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=2, max_length=255)
    account_type: Literal["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]
    normal_balance: Literal["DEBIT", "CREDIT"]
    category: str = Field(..., min_length=2, max_length=64)
    currency: str = Field(default="GHS", max_length=8)


class AccountOut(ORMBase):
    id: str
    code: str
    name: str
    account_type: str
    normal_balance: str
    category: str
    currency: str
    merchant_id: Optional[str] = None
    is_system: bool
    is_active: bool
    created_at: datetime


class AccountBalanceOut(AccountOut):
    debit_total: Decimal
    credit_total: Decimal
    balance: Decimal


# --- Journal Entries & Lines ---
class JournalLineCreate(BaseModel):
    account_id: str
    direction: Literal["DEBIT", "CREDIT"]
    amount: Decimal = Field(..., gt=0)
    merchant_id: Optional[str] = None
    line_memo: Optional[str] = None


class JournalEntryCreate(BaseModel):
    idempotency_key: str = Field(..., min_length=3, max_length=128)
    external_reference: Optional[str] = Field(default=None, max_length=128)
    correlation_id: Optional[str] = Field(default=None, max_length=128)
    event_type: str = Field(..., min_length=2, max_length=64)
    description: str = Field(..., min_length=2)
    currency: str = Field(default="GHS", max_length=8)
    occurred_at: Optional[datetime] = None
    created_by: str = Field(default="API_CLIENT", max_length=128)
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    lines: list[JournalLineCreate] = Field(..., min_length=2)


class JournalLineOut(ORMBase):
    id: str
    account_id: str
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    direction: str
    amount: Decimal
    currency: str
    merchant_id: Optional[str] = None
    line_memo: Optional[str] = None
    created_at: datetime


class JournalEntryOut(ORMBase):
    id: str
    entry_number: str
    idempotency_key: str
    external_reference: Optional[str] = None
    correlation_id: Optional[str] = None
    event_type: str
    description: str
    currency: str
    total_amount: Decimal
    reverses_entry_id: Optional[str] = None
    status: str
    occurred_at: datetime
    posted_at: datetime
    created_by: str
    metadata_json: dict[str, Any]
    lines: list[JournalLineOut] = Field(default_factory=list)


class ReversalRequest(BaseModel):
    idempotency_key: str = Field(..., min_length=3, max_length=128)
    reason: str = Field(..., min_length=3)
    actor_id: str = Field(default="ADMIN_USER", max_length=128)


# --- Merchants & Sub-Merchants ---
class MerchantCreate(BaseModel):
    external_merchant_id: str = Field(..., min_length=2, max_length=128)
    parent_merchant_id: Optional[str] = None
    name: str = Field(..., min_length=2, max_length=255)
    merchant_type: Literal["MERCHANT", "SUB_MERCHANT"] = "MERCHANT"
    settlement_schedule: str = Field(default="CONFIGURABLE", max_length=64)
    default_currency: str = Field(default="GHS", max_length=8)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class MerchantOut(ORMBase):
    id: str
    external_merchant_id: str
    parent_merchant_id: Optional[str] = None
    name: str
    merchant_type: str
    status: str
    settlement_schedule: str
    default_currency: str
    created_at: datetime


class MerchantSummaryOut(MerchantOut):
    available_balance: Decimal
    pending_balance: Decimal
    total_collections: Decimal
    total_disbursements: Decimal
    total_refunds: Decimal
    sub_merchant_count: int = 0


# --- Integration Events (JuniPay Core -> Ledger Contract) ---
class JuniPayTransactionEvent(BaseModel):
    """
    Canonical Integration Contract for JuniPay transaction-processing system.
    """
    idempotency_key: str = Field(..., min_length=3, max_length=128)
    event_type: Literal["COLLECTION", "DISBURSEMENT", "REFUND", "REVERSAL"]
    external_reference: str = Field(..., min_length=2, max_length=128)
    correlation_id: Optional[str] = Field(default=None, max_length=128)
    external_merchant_id: str = Field(..., min_length=2, max_length=128)
    ova_code: str = Field(default="OVA_MAIN", max_length=64)
    gross_amount: Decimal = Field(..., gt=0)
    fee_amount: Decimal = Field(default=Decimal("0.0000"), ge=0)
    partner_fee_amount: Decimal = Field(default=Decimal("0.0000"), ge=0)
    currency: str = Field(default="GHS", max_length=8)
    hold_mode: Optional[Literal["PENDING", "AVAILABLE"]] = None
    target_entry_id: Optional[str] = None  # Required for REVERSAL
    description: Optional[str] = None
    occurred_at: Optional[datetime] = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("fee_amount")
    @classmethod
    def fee_cannot_exceed_gross(cls, v: Decimal, info):
        gross = info.data.get("gross_amount")
        if gross is not None and v > gross:
            raise ValueError("fee_amount cannot exceed gross_amount")
        return v


class IntegrationEventOut(ORMBase):
    id: str
    idempotency_key: str
    event_type: str
    external_reference: Optional[str] = None
    correlation_id: Optional[str] = None
    processing_status: str
    journal_entry_id: Optional[str] = None
    error_message: Optional[str] = None
    received_at: datetime


# --- OVA Mirror & Management ---
class OvaAccountCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=64)
    provider_code: str = Field(..., min_length=2, max_length=64)
    provider_name: str = Field(..., min_length=2, max_length=128)
    account_type: Literal["COLLECTION_OVA", "PAYOUT_OVA", "SETTLEMENT_ACCOUNT"] = "COLLECTION_OVA"
    account_number_masked: str = Field(..., min_length=2, max_length=64)
    currency: str = Field(default="GHS", max_length=8)


class OvaAccountOut(ORMBase):
    id: str
    code: str
    provider_code: str
    provider_name: str
    account_type: str
    account_number_masked: str
    currency: str
    ledger_account_id: str
    sync_status: str
    last_synced_at: Optional[datetime] = None
    is_active: bool
    ledger_balance: Decimal = Decimal("0")
    external_reported_balance: Optional[Decimal] = None
    variance: Optional[Decimal] = None


class OvaSyncRequest(BaseModel):
    provider_reported_balance: Decimal
    sync_status: Literal["SYNCED", "PENDING", "STALE", "ERROR"] = "SYNCED"


class OvaOverviewOut(BaseModel):
    currency: str
    total_mirrored_balance: Decimal
    total_provider_reported_balance: Decimal
    total_variance: Decimal
    total_collections: Decimal
    total_withdrawals: Decimal
    total_provider_fees: Decimal
    unreconciled_amount: Decimal
    unreconciled_count: int
    open_exceptions: int
    account_count: int


class OvaTransactionOut(BaseModel):
    id: str
    ova_code: str
    provider_name: str
    entry_number: str
    external_reference: Optional[str] = None
    event_type: str
    direction: str
    amount: Decimal
    running_balance: Decimal
    currency: str
    description: str
    status: str
    occurred_at: datetime


class OvaLiquidationCreate(BaseModel):
    source_ova_code: str
    destination_ova_code: str
    gross_amount: Decimal = Field(..., gt=0)
    provider_fee_amount: Decimal = Field(default=Decimal("0"), ge=0)
    external_transfer_ref: Optional[str] = None
    notes: Optional[str] = None


class OvaLiquidationOut(ORMBase):
    id: str
    liquidation_ref: str
    source_ova_id: str
    source_ova_code: Optional[str] = None
    destination_ova_id: str
    destination_ova_code: Optional[str] = None
    currency: str
    gross_amount: Decimal
    provider_fee_amount: Decimal
    net_amount: Decimal
    external_transfer_ref: Optional[str] = None
    status: str
    journal_entry_id: Optional[str] = None
    notes: Optional[str] = None
    initiated_by: str
    completed_by: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime


class OvaStatementIngest(BaseModel):
    ova_code: str = Field(default="OVA_MAIN", max_length=64)
    external_tx_ref: str = Field(..., min_length=2, max_length=128)
    direction: Literal["CREDIT", "DEBIT"]
    amount: Decimal = Field(..., gt=0)
    running_balance: Optional[Decimal] = None
    currency: str = Field(default="GHS", max_length=8)
    narration: Optional[str] = None
    value_date: Optional[datetime] = None


class OvaStatementEntryOut(ORMBase):
    id: str
    ova_account_id: str
    external_tx_ref: str
    direction: str
    amount: Decimal
    running_balance: Optional[Decimal] = None
    currency: str
    narration: Optional[str] = None
    value_date: datetime
    ingested_at: datetime
    matched_journal_entry_id: Optional[str] = None
    reconciliation_status: str


# --- Settlements ---
class SettlementBatchCreate(BaseModel):
    external_merchant_id: str
    currency: str = Field(default="GHS", max_length=8)
    fee_amount: Decimal = Field(default=Decimal("0"), ge=0)
    external_payout_ref: Optional[str] = None
    description: Optional[str] = None


class SettlementBatchOut(ORMBase):
    id: str
    batch_reference: str
    merchant_id: str
    merchant_name: Optional[str] = None
    currency: str
    gross_amount: Decimal
    fee_amount: Decimal
    net_amount: Decimal
    status: str
    settlement_journal_entry_id: Optional[str] = None
    external_payout_ref: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    settled_at: Optional[datetime] = None
    created_at: datetime


# --- Reconciliation ---
class ReconciliationRunRequest(BaseModel):
    ova_code: str = Field(default="OVA_MAIN", max_length=64)
    executed_by: str = Field(default="ADMIN_USER", max_length=128)


class ReconciliationDiscrepancyOut(ORMBase):
    id: str
    run_id: str
    discrepancy_type: str
    external_tx_ref: Optional[str] = None
    journal_entry_id: Optional[str] = None
    expected_amount: Optional[Decimal] = None
    actual_amount: Optional[Decimal] = None
    difference_amount: Optional[Decimal] = None
    resolution_status: str
    resolution_notes: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime


class ReconciliationRunOut(ORMBase):
    id: str
    run_reference: str
    ova_account_id: Optional[str] = None
    currency: str
    ledger_ova_balance: Decimal
    external_ova_balance: Decimal
    variance_amount: Decimal
    matched_count: int
    discrepancy_count: int
    status: str
    executed_by: str
    executed_at: datetime
    discrepancies: list[ReconciliationDiscrepancyOut] = Field(default_factory=list)


class DiscrepancyResolveRequest(BaseModel):
    resolution_status: Literal["INVESTIGATING", "RESOLVED"]
    resolution_notes: str = Field(..., min_length=3)
    resolved_by: str = Field(default="FINANCE_OPS", max_length=128)


# --- Audit Logs ---
class AuditLogOut(ORMBase):
    id: str
    actor_id: str
    actor_type: str
    action: str
    resource_type: str
    resource_id: str
    correlation_id: Optional[str] = None
    previous_state: Optional[dict[str, Any]] = None
    new_state: Optional[dict[str, Any]] = None
    created_at: datetime


# --- Dashboard ---
class DashboardSummaryOut(BaseModel):
    currency: str
    total_collections: Decimal
    total_disbursements: Decimal
    total_refunds: Decimal
    total_fee_revenue: Decimal
    total_partner_costs: Decimal
    total_operational_expenses: Decimal = Decimal("0")
    net_psp_revenue: Decimal
    total_available_balance: Decimal
    total_pending_settlement: Decimal
    total_merchant_obligations: Decimal
    ova_ledger_balance: Decimal
    total_provider_ova_balances: Decimal = Decimal("0")
    total_bank_balances: Decimal = Decimal("0")
    ova_external_balance: Optional[Decimal] = None
    ova_variance: Optional[Decimal] = None
    ova_coverage_surplus: Decimal
    open_discrepancies: int
    pending_settlement_batches: int
    pending_ussd_verifications: int = 0
    trial_balance_debits: Decimal
    trial_balance_credits: Decimal
    is_balanced: bool
    has_sample_data: bool
