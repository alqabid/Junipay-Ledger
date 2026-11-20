# JuniPay Financial Ledger — Integration Contract

This document defines the REST & Webhook contract for connecting JuniPay's core transaction-processing system to the **JuniPay Financial Ledger Module**.

---

## 1. Confirmed Requirements vs. Configurable Assumptions

| Aspect | Classification | Current MVP Behavior / Config |
| :--- | :--- | :--- |
| Double-entry accounting (`DR == CR`) | **Confirmed Requirement** | Enforced in `post_journal_entry()` and DB check constraints. Unbalanced entries return `422`. |
| Immutable financial records | **Confirmed Requirement** | Posted `journal_entries`, `journal_lines`, and `audit_logs` cannot be edited or deleted (enforced in app & PostgreSQL triggers in `001_postgres_schema.sql`). Corrections use `REVERSAL` counter-entries. |
| Idempotent event ingestion | **Confirmed Requirement** | Every integration event requires a unique `idempotency_key`. Duplicate deliveries return the existing `journal_entry_id`. |
| Default currency | **Configurable Assumption** | Configured via `DEFAULT_CURRENCY` (default `GHS`), overridable per event/merchant. |
| Collection settlement hold mode | **Configurable Assumption** | Configured via `SETTLEMENT_DEFAULT_HOLD_MODE` (`PENDING` or `AVAILABLE`, default `PENDING`). |
| Fee calculation | **Configurable Assumption** | Ledger does **not** invent fees. `fee_amount` is accepted from JuniPay Core per event (defaults to `0.0000` if omitted). |
| Webhook signature verification | **Configurable Assumption** | `X-JuniPay-Signature` (HMAC-SHA256 using `WEBHOOK_HMAC_SECRET`). `ALLOW_UNSIGNED_DEV_EVENTS=true` only for local dev. |
| Settlement schedule (`T+0`, `T+1`, etc.) | **Configurable Assumption** | Stored as metadata on `merchants.settlement_schedule`; batches are triggered via API or scheduler. |

---

## 2. Canonical Event Ingestion Endpoint

`POST /api/v1/integrations/events`

### Headers
- `Content-Type: application/json`
- `X-JuniPay-Signature: sha256=<hex_hmac_sha256_of_raw_body>` (required when `ALLOW_UNSIGNED_DEV_EVENTS=false`)

### Request Body (`JuniPayTransactionEvent`)
```json
{
  "idempotency_key": "jp-col-987654321",
  "event_type": "COLLECTION",
  "external_reference": "TXN-2026-0001",
  "correlation_id": "CORR-ABC-123",
  "external_merchant_id": "MRC-SAMPLE-001",
  "ova_code": "OVA_MAIN",
  "gross_amount": "2500.00",
  "fee_amount": "37.50",
  "partner_fee_amount": "0.00",
  "currency": "GHS",
  "hold_mode": "PENDING",
  "description": "Mobile Money checkout",
  "occurred_at": "2026-11-19T09:00:00Z",
  "metadata": {
    "channel": "MoMo",
    "provider": "MTN"
  }
}
```

### Double-Entry Posting Rules by `event_type`
1. **`COLLECTION`**:
   - Separates **Merchant Fund Obligations** from **JuniPay PSP Revenue** and optional **Upstream Partner Processing Costs**:
   - `DEBIT` OVA Mirror (`1000-OVA-MAIN`) = `gross_amount - partner_fee_amount` (mirrors actual OVA custody movement)
   - `DEBIT` Partner Processing Cost (`5000-PARTNER-COST`) = `partner_fee_amount` (if `> 0`)
   - `CREDIT` Merchant Obligation (`MERCHANT_PENDING` or `MERCHANT_AVAILABLE`) = `gross_amount - fee_amount`
   - `CREDIT` JuniPay Fee Revenue (`4000-FEE-REVENUE`) = `fee_amount` (if `> 0`)
2. **`SETTLEMENT`** (via `POST /api/v1/settlements` + `POST /api/v1/settlements/{batch_id}/settle`):
   - `DEBIT` `MERCHANT_PENDING` = `gross_amount`
   - `CREDIT` `MERCHANT_AVAILABLE` = `gross_amount - fee_amount`
   - `CREDIT` `4000-FEE-REVENUE` = `fee_amount` (if `> 0`)
3. **`DISBURSEMENT`**:
   - Validates `MERCHANT_AVAILABLE >= gross_amount` (prevents overdraft).
   - `DEBIT` `MERCHANT_AVAILABLE` = `gross_amount`
   - `CREDIT` OVA Mirror (`1000-OVA-MAIN`) = `gross_amount`
4. **`REFUND`**:
   - `DEBIT` Merchant Liability = `gross_amount - fee_amount`
   - `DEBIT` `4000-FEE-REVENUE` = `fee_amount` (if `> 0`)
   - `CREDIT` OVA Mirror (`1000-OVA-MAIN`) = `gross_amount`
5. **`REVERSAL`**:
   - Posts a balanced counter-journal entry referencing `reverses_entry_id` and marks original entry status as `REVERSED`.

---

## 3. OVA Statement & Reconciliation Endpoints

- `POST /api/v1/ova/statements` — Ingest partner bank / telco OVA statement lines (`external_tx_ref`, `direction`, `amount`, `value_date`).
- `POST /api/v1/reconciliation/run` — Execute reconciliation comparing Ledger OVA Mirror against external OVA statements; flags `MISSING_IN_LEDGER`, `MISSING_IN_OVA`, `AMOUNT_MISMATCH`, and `BALANCE_VARIANCE`.
- `PATCH /api/v1/reconciliation/discrepancies/{id}` — Record investigation/resolution status and notes with full audit logging.
