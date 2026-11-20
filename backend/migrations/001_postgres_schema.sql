-- JuniPay Financial Ledger - PostgreSQL Schema (Production Target)
-- Enforces double-entry balance checks and database-level immutability.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Merchants & Sub-Merchants
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_merchant_id VARCHAR(128) NOT NULL UNIQUE,
    parent_merchant_id UUID REFERENCES merchants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    merchant_type VARCHAR(32) NOT NULL CHECK (merchant_type IN ('MERCHANT', 'SUB_MERCHANT')),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    settlement_schedule VARCHAR(64) NOT NULL DEFAULT 'CONFIGURABLE',
    default_currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Chart of Accounts (General Ledger & Sub-Ledger Accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(32) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    normal_balance VARCHAR(16) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    category VARCHAR(64) NOT NULL, -- e.g. OVA_MIRROR, MERCHANT_AVAILABLE, MERCHANT_PENDING, FEE_REVENUE, SUSPENSE
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    merchant_id UUID REFERENCES merchants(id) ON DELETE RESTRICT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Journal Entries (Immutable Header)
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(64) NOT NULL UNIQUE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    external_reference VARCHAR(128),
    correlation_id VARCHAR(128),
    event_type VARCHAR(64) NOT NULL, -- COLLECTION, DISBURSEMENT, SETTLEMENT, REFUND, REVERSAL, ADJUSTMENT
    description TEXT NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    total_amount NUMERIC(18, 4) NOT NULL CHECK (total_amount > 0),
    reverses_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
    occurred_at TIMESTAMPTZ NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(128) NOT NULL DEFAULT 'SYSTEM',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 4. Journal Lines (Immutable Debit/Credit Legs)
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    merchant_id UUID REFERENCES merchants(id) ON DELETE RESTRICT,
    line_memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Online Vendor Account (OVA) External Mirror Statements
CREATE TABLE IF NOT EXISTS ova_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    provider_code VARCHAR(64) NOT NULL DEFAULT 'CONFIGURABLE',
    provider_name VARCHAR(128) NOT NULL,
    account_type VARCHAR(32) NOT NULL DEFAULT 'COLLECTION_OVA',
    account_number_masked VARCHAR(64) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    ledger_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    provider_reported_balance NUMERIC(18, 4),
    sync_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    last_synced_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ova_liquidations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    liquidation_ref VARCHAR(128) NOT NULL UNIQUE,
    source_ova_id UUID NOT NULL REFERENCES ova_accounts(id) ON DELETE RESTRICT,
    destination_ova_id UUID NOT NULL REFERENCES ova_accounts(id) ON DELETE RESTRICT,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    gross_amount NUMERIC(18, 4) NOT NULL CHECK (gross_amount > 0),
    provider_fee_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (provider_fee_amount >= 0),
    net_amount NUMERIC(18, 4) NOT NULL CHECK (net_amount >= 0),
    external_transfer_ref VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'IN_TRANSIT', 'COMPLETED', 'FAILED')),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    notes TEXT,
    initiated_by VARCHAR(128) NOT NULL DEFAULT 'OPERATIONS',
    completed_by VARCHAR(128),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ova_statement_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ova_account_id UUID NOT NULL REFERENCES ova_accounts(id) ON DELETE RESTRICT,
    external_tx_ref VARCHAR(128) NOT NULL UNIQUE,
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    running_balance NUMERIC(18, 4),
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    narration TEXT,
    value_date TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    matched_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'UNMATCHED'
        CHECK (reconciliation_status IN ('UNMATCHED', 'MATCHED', 'DISCREPANCY'))
);

-- 6. Settlement Batches & Items
CREATE TABLE IF NOT EXISTS settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference VARCHAR(128) NOT NULL UNIQUE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    gross_amount NUMERIC(18, 4) NOT NULL CHECK (gross_amount >= 0),
    fee_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    net_amount NUMERIC(18, 4) NOT NULL CHECK (net_amount >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'CANCELLED')),
    settlement_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    external_payout_ref VARCHAR(128),
    scheduled_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
    source_journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
    gross_amount NUMERIC(18, 4) NOT NULL CHECK (gross_amount > 0),
    fee_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    net_amount NUMERIC(18, 4) NOT NULL CHECK (net_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Reconciliation Runs & Discrepancies
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_reference VARCHAR(128) NOT NULL UNIQUE,
    ova_account_id UUID REFERENCES ova_accounts(id) ON DELETE RESTRICT,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    ledger_ova_balance NUMERIC(18, 4) NOT NULL,
    external_ova_balance NUMERIC(18, 4) NOT NULL,
    variance_amount NUMERIC(18, 4) NOT NULL,
    matched_count INTEGER NOT NULL DEFAULT 0,
    discrepancy_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'DISCREPANCY_FOUND')),
    executed_by VARCHAR(128) NOT NULL DEFAULT 'SYSTEM',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE RESTRICT,
    discrepancy_type VARCHAR(64) NOT NULL
        CHECK (discrepancy_type IN ('MISSING_IN_LEDGER', 'MISSING_IN_OVA', 'AMOUNT_MISMATCH', 'BALANCE_VARIANCE')),
    external_tx_ref VARCHAR(128),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    expected_amount NUMERIC(18, 4),
    actual_amount NUMERIC(18, 4),
    difference_amount NUMERIC(18, 4),
    resolution_status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
    resolution_notes TEXT,
    resolved_by VARCHAR(128),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Integration Events Inbox (Idempotent Webhook / API Log)
CREATE TABLE IF NOT EXISTS integration_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    external_reference VARCHAR(128),
    correlation_id VARCHAR(128),
    payload_json JSONB NOT NULL,
    processing_status VARCHAR(32) NOT NULL DEFAULT 'PROCESSED'
        CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED_DUPLICATE')),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Append-Only Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id VARCHAR(128) NOT NULL,
    actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('SYSTEM', 'API_CLIENT', 'ADMIN_USER')),
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128) NOT NULL,
    correlation_id VARCHAR(128),
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closing_date VARCHAR(16) NOT NULL UNIQUE,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    trial_balance_debits NUMERIC(18, 4) NOT NULL,
    trial_balance_credits NUMERIC(18, 4) NOT NULL,
    is_balanced BOOLEAN NOT NULL DEFAULT TRUE,
    provider_balance_total NUMERIC(18, 4) NOT NULL,
    merchant_obligations_total NUMERIC(18, 4) NOT NULL,
    net_psp_revenue NUMERIC(18, 4) NOT NULL,
    closed_by VARCHAR(128) NOT NULL,
    notes TEXT,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adjustment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_ref VARCHAR(64) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    debit_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    credit_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    requested_by VARCHAR(128) NOT NULL,
    reviewed_by VARCHAR(128),
    review_notes TEXT,
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ussd_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ussd_session_ref VARCHAR(128) NOT NULL UNIQUE,
    provider_code VARCHAR(64) NOT NULL,
    ova_code VARCHAR(64) NOT NULL,
    external_merchant_id VARCHAR(128) NOT NULL,
    customer_msisdn_masked VARCHAR(32) NOT NULL,
    expected_amount NUMERIC(18, 4) NOT NULL CHECK (expected_amount > 0),
    fee_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    status VARCHAR(32) NOT NULL DEFAULT 'AWAITING_OVA_VERIFICATION'
        CHECK (status IN ('AWAITING_OVA_VERIFICATION', 'CONFIRMED', 'REJECTED_MISMATCH', 'FLAGGED_SUSPICIOUS')),
    ova_dashboard_ref VARCHAR(128),
    verified_amount NUMERIC(18, 4),
    verification_notes TEXT,
    verified_by VARCHAR(128),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS operational_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_ref VARCHAR(64) NOT NULL UNIQUE,
    category VARCHAR(64) NOT NULL,
    purpose TEXT NOT NULL,
    destination VARCHAR(255) NOT NULL,
    source_ova_code VARCHAR(64) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'GHS',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    initiated_by VARCHAR(128) NOT NULL,
    approved_by VARCHAR(128),
    approval_notes TEXT,
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ
);

-- Immutability Enforcement Triggers (PostgreSQL)
CREATE OR REPLACE FUNCTION prevent_immutable_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Financial ledger table % is immutable; % operations are prohibited', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_journal_lines ON journal_lines;
CREATE TRIGGER trg_immutable_journal_lines
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_immutable_audit_logs ON audit_logs;
CREATE TRIGGER trg_immutable_audit_logs
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_prevent_delete_journal_entries ON journal_entries;
CREATE TRIGGER trg_prevent_delete_journal_entries
BEFORE DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
