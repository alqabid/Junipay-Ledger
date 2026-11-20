export type InternalRole = "OPERATIONS" | "FINANCE" | "FINANCE_MANAGER" | "MANAGEMENT" | "ADMIN";

export interface FinancialReport {
  currency: string;
  period?: string;
  trial_balance: {
    rows: {
      code: string;
      name: string;
      account_type: string;
      debit_total: string;
      credit_total: string;
      net_balance: string;
      currency: string;
    }[];
    total_debits: string;
    total_credits: string;
    is_balanced: boolean;
  };
  psp_income_statement: {
    fee_revenue: string;
    partner_processing_costs: string;
    operational_expenses?: string;
    net_psp_margin: string;
  };
  custody_position: {
    ova_mirror_balance: string;
    total_merchant_obligations: string;
    coverage_surplus: string;
  };
  merchant_obligations: {
    external_merchant_id: string;
    name: string;
    merchant_type: string;
    available_balance: string;
    pending_balance: string;
    total_obligation: string;
    currency: string;
  }[];
}

export interface DashboardSummary {
  currency: string;
  total_collections: string;
  total_disbursements: string;
  total_refunds: string;
  total_fee_revenue: string;
  total_partner_costs: string;
  total_operational_expenses: string;
  net_psp_revenue: string;
  total_available_balance: string;
  total_pending_settlement: string;
  total_merchant_obligations: string;
  ova_ledger_balance: string;
  total_provider_ova_balances: string;
  total_bank_balances: string;
  ova_external_balance: string | null;
  ova_variance: string | null;
  ova_coverage_surplus: string;
  open_discrepancies: number;
  pending_settlement_batches: number;
  pending_ussd_verifications: number;
  trial_balance_debits: string;
  trial_balance_credits: string;
  is_balanced: boolean;
  has_sample_data: boolean;
}

export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normal_balance: "DEBIT" | "CREDIT";
  category: string;
  currency: string;
  merchant_id: string | null;
  is_system: boolean;
  is_active: boolean;
  debit_total: string;
  credit_total: string;
  balance: string;
}

export interface JournalLine {
  id: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  currency: string;
  merchant_id: string | null;
  line_memo: string | null;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  idempotency_key: string;
  external_reference: string | null;
  correlation_id: string | null;
  event_type: string;
  description: string;
  currency: string;
  total_amount: string;
  reverses_entry_id: string | null;
  status: "POSTED" | "REVERSED";
  occurred_at: string;
  posted_at: string;
  created_by: string;
  lines: JournalLine[];
}

export interface MerchantSummary {
  id: string;
  external_merchant_id: string;
  parent_merchant_id: string | null;
  name: string;
  merchant_type: "MERCHANT" | "SUB_MERCHANT";
  status: string;
  settlement_schedule: string;
  default_currency: string;
  created_at: string;
  available_balance: string;
  pending_balance: string;
  total_collections: string;
  total_disbursements: string;
  total_refunds: string;
  sub_merchant_count: number;
}

export interface OvaAccount {
  id: string;
  code: string;
  provider_code: string;
  provider_name: string;
  account_type: "COLLECTION_OVA" | "PAYOUT_OVA" | "SETTLEMENT_ACCOUNT";
  account_number_masked: string;
  currency: string;
  ledger_account_id: string;
  sync_status: string;
  last_synced_at: string | null;
  is_active: boolean;
  ledger_balance: string;
  external_reported_balance: string | null;
  variance: string | null;
}

export interface OvaOverview {
  currency: string;
  total_mirrored_balance: string;
  total_provider_reported_balance: string;
  total_variance: string;
  total_collections: string;
  total_withdrawals: string;
  total_provider_fees: string;
  unreconciled_amount: string;
  unreconciled_count: number;
  open_exceptions: number;
  account_count: number;
}

export interface OvaTransaction {
  id: string;
  ova_code: string;
  provider_name: string;
  entry_number: string;
  external_reference: string | null;
  event_type: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  running_balance: string;
  currency: string;
  description: string;
  status: string;
  occurred_at: string;
}

export interface OvaLiquidation {
  id: string;
  liquidation_ref: string;
  source_ova_id: string;
  source_ova_code: string | null;
  destination_ova_id: string;
  destination_ova_code: string | null;
  currency: string;
  gross_amount: string;
  provider_fee_amount: string;
  net_amount: string;
  external_transfer_ref: string | null;
  status: "INITIATED" | "IN_TRANSIT" | "COMPLETED" | "FAILED";
  journal_entry_id: string | null;
  notes: string | null;
  initiated_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface OvaExceptionsFeed {
  discrepancies: {
    id: string;
    discrepancy_type: string;
    external_tx_ref: string | null;
    expected_amount: string | null;
    actual_amount: string | null;
    difference_amount: string | null;
    resolution_status: string;
    resolution_notes: string | null;
    created_at: string;
  }[];
  sync_alerts: {
    ova_code: string;
    provider_name: string;
    sync_status: string;
    last_synced_at: string | null;
  }[];
}

export interface OvaStatementEntry {
  id: string;
  ova_account_id: string;
  external_tx_ref: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  running_balance: string | null;
  currency: string;
  narration: string | null;
  value_date: string;
  matched_journal_entry_id: string | null;
  reconciliation_status: "UNMATCHED" | "MATCHED" | "DISCREPANCY";
}

export interface SettlementBatch {
  id: string;
  batch_reference: string;
  merchant_id: string;
  merchant_name: string | null;
  currency: string;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  status: "PENDING" | "PROCESSING" | "SETTLED" | "FAILED" | "CANCELLED";
  settlement_journal_entry_id: string | null;
  external_payout_ref: string | null;
  scheduled_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface ReconciliationDiscrepancy {
  id: string;
  run_id: string;
  discrepancy_type: string;
  external_tx_ref: string | null;
  journal_entry_id: string | null;
  expected_amount: string | null;
  actual_amount: string | null;
  difference_amount: string | null;
  resolution_status: "OPEN" | "INVESTIGATING" | "RESOLVED";
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ReconciliationRun {
  id: string;
  run_reference: string;
  ova_account_id: string | null;
  currency: string;
  ledger_ova_balance: string;
  external_ova_balance: string;
  variance_amount: string;
  matched_count: number;
  discrepancy_count: number;
  status: "COMPLETED" | "DISCREPANCY_FOUND";
  executed_by: string;
  executed_at: string;
  discrepancies: ReconciliationDiscrepancy[];
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  correlation_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}
