import type {
  AccountBalance,
  AuditLog,
  DashboardSummary,
  FinancialReport,
  InternalRole,
  JournalEntry,
  JournalLine,
  MerchantSummary,
  OvaAccount,
  OvaExceptionsFeed,
  OvaLiquidation,
  OvaOverview,
  OvaStatementEntry,
  OvaTransaction,
  ReconciliationRun,
  SettlementBatch,
} from "../types/ledger";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

let currentRole: InternalRole = "FINANCE";
export function setActiveRole(role: InternalRole) {
  currentRole = role;
}
export function getActiveRole(): InternalRole {
  return currentRole;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-JuniPay-Role": currentRole,
      "X-JuniPay-Actor": `${currentRole}_STAFF`,
      ...(options?.headers ?? {}),
    },
    ...options,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // ignore non-json
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function formatMoney(value: string | number | null | undefined, currency = "GHS"): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  return `${currency} ${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const api = {
  getDashboardSummary: () => request<DashboardSummary>("/dashboard/summary"),
  seedSampleData: () => request<{ seeded: boolean; message: string }>("/demo/seed", { method: "POST" }),

  getAccounts: () => request<AccountBalance[]>("/ledger/accounts"),
  getLedgerSummary: () =>
    request<{
      currencies: {
        currency: string;
        assets: string;
        liabilities: string;
        equity: string;
        revenue: string;
        expenses: string;
        net_income: string;
        total_debits: string;
        total_credits: string;
        is_trial_balanced: boolean;
        is_equation_balanced: boolean;
      }[];
      account_count: number;
    }>("/ledger/summary"),
  createAccount: (payload: {
    code: string;
    name: string;
    account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
    normal_balance: "DEBIT" | "CREDIT";
    category: string;
    currency: string;
  }) =>
    request("/ledger/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getAccountTransactions: (accountId: string) =>
    request<{
      account: {
        id: string;
        code: string;
        name: string;
        account_type: string;
        normal_balance: string;
        category: string;
        currency: string;
        debit_total: string;
        credit_total: string;
        balance: string;
      };
      transactions: {
        id: string;
        entry_id: string;
        entry_number: string;
        event_type: string;
        external_reference: string | null;
        direction: "DEBIT" | "CREDIT";
        amount: string;
        running_balance: string;
        currency: string;
        description: string;
        status: string;
        occurred_at: string;
      }[];
    }>(`/ledger/accounts/${accountId}/transactions`),
  getJournalEntries: (eventType?: string) =>
    request<JournalEntry[]>(`/ledger/entries${eventType ? `?event_type=${encodeURIComponent(eventType)}` : ""}`),
  createJournalEntry: (payload: {
    idempotency_key: string;
    external_reference?: string;
    event_type: string;
    description: string;
    currency: string;
    created_by: string;
    lines: {
      account_id: string;
      direction: "DEBIT" | "CREDIT";
      amount: string;
      line_memo?: string;
    }[];
  }) =>
    request<JournalEntry>("/ledger/entries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  reverseEntry: (entryId: string, reason: string) =>
    request<JournalEntry>(`/ledger/entries/${entryId}/reverse`, {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: `ui-rev-${entryId}-${Date.now()}`,
        reason,
        actor_id: "FINANCE_OPS_UI",
      }),
    }),

  getMerchants: () => request<MerchantSummary[]>("/merchants"),
  getMerchantLedger: (merchantId: string) => request<JournalLine[]>(`/merchants/${merchantId}/ledger`),
  createMerchant: (payload: {
    external_merchant_id: string;
    name: string;
    merchant_type: "MERCHANT" | "SUB_MERCHANT";
    parent_merchant_id?: string | null;
    default_currency: string;
  }) =>
    request("/merchants", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  ingestTransactionEvent: (payload: {
    idempotency_key: string;
    event_type: "COLLECTION" | "DISBURSEMENT" | "REFUND";
    external_reference: string;
    external_merchant_id: string;
    gross_amount: string;
    fee_amount: string;
    currency: string;
    hold_mode?: "PENDING" | "AVAILABLE";
    description?: string;
  }) =>
    request("/integrations/events", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getOvaOverview: () => request<OvaOverview>("/ova/overview"),
  getOvaAccounts: () => request<OvaAccount[]>("/ova/accounts"),
  createOvaAccount: (payload: {
    code: string;
    provider_code: string;
    provider_name: string;
    account_type: "COLLECTION_OVA" | "PAYOUT_OVA" | "SETTLEMENT_ACCOUNT";
    account_number_masked: string;
    currency: string;
  }) =>
    request<OvaAccount>("/ova/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  syncOvaBalance: (ovaCode: string, provider_reported_balance: string) =>
    request<OvaAccount>(`/ova/accounts/${encodeURIComponent(ovaCode)}/sync`, {
      method: "POST",
      body: JSON.stringify({ provider_reported_balance, sync_status: "SYNCED" }),
    }),
  getOvaTransactions: (ovaCode?: string) =>
    request<OvaTransaction[]>(`/ova/transactions${ovaCode ? `?ova_code=${encodeURIComponent(ovaCode)}` : ""}`),
  getOvaBalanceMovement: (ovaCode?: string) =>
    request<{
      currency: string;
      opening_balance: string;
      collections: string;
      withdrawals: string;
      provider_fees: string;
      reversals_refunds: string;
      liquidations_net: string;
      closing_balance: string;
    }>(`/ova/balance-movement${ovaCode ? `?ova_code=${encodeURIComponent(ovaCode)}` : ""}`),
  getOvaLiquidations: () => request<OvaLiquidation[]>("/ova/liquidations"),
  createOvaLiquidation: (payload: {
    source_ova_code: string;
    destination_ova_code: string;
    gross_amount: string;
    provider_fee_amount: string;
    external_transfer_ref?: string;
    notes?: string;
  }) =>
    request<OvaLiquidation>("/ova/liquidations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  completeOvaLiquidation: (id: string) =>
    request<OvaLiquidation>(`/ova/liquidations/${id}/complete`, { method: "POST" }),
  getOvaExceptions: () => request<OvaExceptionsFeed>("/ova/exceptions"),
  getOvaStatements: () => request<OvaStatementEntry[]>("/ova/statements"),
  ingestOvaStatement: (payload: {
    ova_code: string;
    external_tx_ref: string;
    direction: "CREDIT" | "DEBIT";
    amount: string;
    currency: string;
    narration: string;
  }) =>
    request<OvaStatementEntry>("/ova/statements", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getSettlements: () => request<SettlementBatch[]>("/settlements"),
  createSettlement: (payload: { external_merchant_id: string; currency: string; fee_amount: string }) =>
    request<SettlementBatch>("/settlements", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  settleBatch: (batchId: string) =>
    request<SettlementBatch>(`/settlements/${batchId}/settle`, { method: "POST" }),

  getReconciliationRuns: () => request<ReconciliationRun[]>("/reconciliation/runs"),
  runReconciliation: (ovaCode = "OVA_MAIN") =>
    request<ReconciliationRun>("/reconciliation/run", {
      method: "POST",
      body: JSON.stringify({ ova_code: ovaCode, executed_by: "FINANCE_OPS_UI" }),
    }),
  resolveDiscrepancy: (discrepancyId: string, resolution_status: "INVESTIGATING" | "RESOLVED", resolution_notes: string) =>
    request(`/reconciliation/discrepancies/${discrepancyId}`, {
      method: "PATCH",
      body: JSON.stringify({ resolution_status, resolution_notes, resolved_by: "FINANCE_OPS_UI" }),
    }),

  getAuditLogs: () => request<AuditLog[]>("/audit-logs"),
  getFinancialReports: (period?: string) =>
    request<FinancialReport>(`/reports/financial-summary${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  getTransactions: (params?: { search?: string; event_type?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.event_type) qs.set("event_type", params.event_type);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return request<
      {
        id: string;
        entry_number: string;
        external_reference: string | null;
        correlation_id: string | null;
        event_type: string;
        channel: string;
        description: string;
        currency: string;
        total_amount: string;
        status: string;
        reverses_entry_id: string | null;
        reconciliation_status: string;
        occurred_at: string;
        posted_at: string;
        created_by: string;
        lines: {
          id: string;
          account_code: string | null;
          account_name: string | null;
          direction: "DEBIT" | "CREDIT";
          amount: string;
          line_memo: string | null;
        }[];
      }[]
    >(`/transactions${q ? `?${q}` : ""}`);
  },
  getDailyClosings: () =>
    request<
      {
        id: string;
        closing_date: string;
        currency: string;
        trial_balance_debits: string;
        trial_balance_credits: string;
        is_balanced: boolean;
        provider_balance_total: string;
        merchant_obligations_total: string;
        net_psp_revenue: string;
        closed_by: string;
        notes: string | null;
        closed_at: string;
      }[]
    >("/reports/daily-closings"),
  executeDailyClose: (notes?: string) =>
    request("/reports/daily-close", {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  getAdjustments: () =>
    request<
      {
        id: string;
        request_ref: string;
        description: string;
        currency: string;
        debit_account_id: string;
        credit_account_id: string;
        amount: string;
        status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
        requested_by: string;
        reviewed_by: string | null;
        review_notes: string | null;
        journal_entry_id: string | null;
        created_at: string;
      }[]
    >("/reports/adjustments"),
  requestAdjustment: (payload: {
    description: string;
    debit_account_id: string;
    credit_account_id: string;
    amount: string;
    currency: string;
  }) =>
    request("/reports/adjustments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  approveAdjustment: (id: string, review_notes?: string) =>
    request(`/reports/adjustments/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ review_notes }),
    }),
  rejectAdjustment: (id: string, review_notes?: string) =>
    request(`/reports/adjustments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ review_notes }),
    }),
  getUssdVerifications: () =>
    request<
      {
        id: string;
        ussd_session_ref: string;
        provider_code: string;
        ova_code: string;
        external_merchant_id: string;
        customer_msisdn_masked: string;
        expected_amount: string;
        fee_amount: string;
        currency: string;
        status: "AWAITING_OVA_VERIFICATION" | "CONFIRMED" | "REJECTED_MISMATCH" | "FLAGGED_SUSPICIOUS";
        ova_dashboard_ref: string | null;
        verified_amount: string | null;
        verification_notes: string | null;
        verified_by: string | null;
        journal_entry_id: string | null;
        initiated_at: string;
      }[]
    >("/ussd/verifications"),
  confirmUssdVerification: (
    id: string,
    payload: { ova_dashboard_ref: string; verified_amount: string; verification_notes?: string }
  ) =>
    request(`/ussd/verifications/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rejectUssdVerification: (
    id: string,
    payload: { decision: "REJECTED_MISMATCH" | "FLAGGED_SUSPICIOUS"; verification_notes: string }
  ) =>
    request(`/ussd/verifications/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getExpenses: () =>
    request<
      {
        id: string;
        expense_ref: string;
        category: string;
        purpose: string;
        destination: string;
        source_ova_code: string;
        amount: string;
        currency: string;
        status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
        initiated_by: string;
        approved_by: string | null;
        approval_notes: string | null;
        journal_entry_id: string | null;
        created_at: string;
      }[]
    >("/expenses"),
  createExpense: (payload: {
    category: string;
    purpose: string;
    destination: string;
    source_ova_code: string;
    amount: string;
    currency: string;
  }) =>
    request("/expenses", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  approveExpense: (id: string, approval_notes?: string) =>
    request(`/expenses/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approval_notes }),
    }),
  rejectExpense: (id: string, approval_notes?: string) =>
    request(`/expenses/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ approval_notes }),
    }),
};
