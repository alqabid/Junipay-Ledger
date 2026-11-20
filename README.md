# JuniPay Finance & Operations Ledger (MVP)

Internal **Finance, Operations, and Management** ledger and Online Vendor Account (OVA) mirror for **JuniPay**, a Payment Service Provider (PSP) in Ghana. Designed as an integration-ready double-entry financial accounting layer that complements JuniPay's core transaction-processing infrastructure.

## Stack
- **Backend:** Python, FastAPI, SQLAlchemy 2.0, Pydantic v2
- **Database:** PostgreSQL (production schema + immutability triggers in `backend/migrations/001_postgres_schema.sql`; SQLite fallback supported for quick local MVP testing)
- **Frontend:** React, TypeScript, Tailwind CSS, Vite

## Core Modules (9 Views)
1. **Dashboard:** Provider & bank custody totals, merchant liabilities, Net PSP Revenue, reconciliation variance, live funds flow pipeline, and Action Centre (`Attention Required`).
2. **General Ledger:** Double-entry accounting (`DR = CR`), structured Chart of Accounts (`Assets`, `Liabilities`, `Equity`, `Revenue`, `Expenses`) with non-posting control rollups (`1000`, `2000`), live accounting equation proof, Journal Builder with templates, immutable reversals, and clickable account-level drill-downs.
3. **Provider Accounts:** Multi-provider monitoring (MTN MoMo, Telecel Cash, AT Money, CalBank, Ecobank), **USSD OVA Verification** workflow, transaction history with running balances, balance movement chart, OVA-to-bank liquidations, and statement imports.
4. **Merchant Accounts:** Merchant & sub-merchant balances (`Available` vs. `Pending Settlement`), collections, payouts, and sub-ledger histories.
5. **Settlements:** Create and execute settlement batches releasing `Pending` → `Available` obligations.
6. **Transaction Monitoring:** Unified searchable transaction records by reference, entry number, correlation ID, or payment channel, with lifecycle inspection modal.
7. **Reconciliation & Exceptions:** Compare internal ledger records against provider and bank statements; investigate (`OPERATIONS`) and resolve (`FINANCE` / `FINANCE_MANAGER` / `ADMIN`) discrepancies.
8. **Reports & Controls:** **Daily / Weekly / Monthly** financial summary (`Trial Balance`, `PSP Income Statement` including operational expenses, `Merchant Obligations`), CSV/Excel & Print/PDF exports, **Daily Closing** EOD snapshots, **Operational Expenses** (maker-checker), and **Adjustment Approvals** (maker-checker).
9. **Audit Trail:** Append-only log of all financial postings, verifications, approvals, settlements, liquidations, and reversals.

## Internal Role-Based Access Control (RBAC)
Enforced in FastAPI via `X-JuniPay-Role` and `X-JuniPay-Actor` headers (switchable in the UI sidebar for MVP testing):
- `OPERATIONS`: USSD verification, merchant onboarding, statement imports, settlement batch initiation, reconciliation investigation, expense & adjustment initiation.
- `FINANCE`: Full accounting (GL accounts/entries, reversals, settlement execution, liquidation completion, daily close, discrepancy resolution, approvals).
- `FINANCE_MANAGER`: Full accounting + maker-checker approval authority for operational expenses and adjustments.
- `MANAGEMENT`: Read-only executive oversight across all dashboards, reports, ledgers, and audit trails (plus review/approval of adjustments and expenses).
- `ADMIN`: Full platform access.

## Documentation
- **Complete Guide & Ghanaian PSP Case Studies:** [JUNIPAY_LEDGER_GUIDE.md](./JUNIPAY_LEDGER_GUIDE.md) | [JUNIPAY_LEDGER_GUIDE.pdf](./JUNIPAY_LEDGER_GUIDE.pdf)
- **Integration Contract & Configurable Assumptions:** [INTEGRATION_CONTRACT.md](./INTEGRATION_CONTRACT.md)

## Quick Start (Local MVP)

### 1. Backend
```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```
API docs: `http://127.0.0.1:8000/docs`

To run with PostgreSQL instead of the local SQLite fallback, copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL=postgresql+psycopg://...` (or use `docker compose up -d`).

### 2. Frontend
```powershell
cd frontend
npm run dev
```
Open `http://localhost:5173` and click **"Load Sample Test Data"** in the sidebar to populate clearly labeled Ghanaian PSP sample merchants, sub-merchants, MTN MoMo / Telecel / AT Money / CalBank / Ecobank accounts, USSD verifications, operational expenses, and reconciliation exceptions.

### 3. Run Tests & Build
```powershell
# Backend test suite
cd backend
.\.venv\Scripts\python.exe -m pytest -v

# Frontend production build
cd frontend
npm run build
```
