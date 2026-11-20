# JuniPay Finance & Operations Ledger — Complete Guide & Case Studies

**Version:** MVP 1.0  
**Audience:** JuniPay Finance, Operations, Finance Managers, Management, and Engineering  
**Purpose:** Internal Source-of-Truth Financial Accounting Layer & Provider OVA Mirror for JuniPay (PSP, Ghana)

---

## 1. The Big Picture: How Everything Works (Simplified)

JuniPay is a **Payment Service Provider (PSP)**. When customers pay merchants via **MTN MoMo**, **Telecel Cash**, **AT Money**, or **GhIPSS (GhQR / GIP)**, the money does **not** belong to JuniPay—only JuniPay's transaction/settlement fees are JuniPay revenue.

This ledger sits alongside JuniPay's payment-processing system as an **immutable double-entry accounting layer**. It answers four critical questions every day:

1. **Where is the money?** (`Assets` — Provider OVAs & Settlement Bank Accounts)
2. **Who do we owe?** (`Liabilities` — Merchant & Sub-Merchant Available + Pending Balances)
3. **What did JuniPay actually earn and spend?** (`Revenue` − `Partner Costs` − `Operational Expenses`)
4. **Do our records match the telcos and banks?** (`Reconciliation` — Expected Ledger Mirror vs. Provider-Reported Balances)

### The Golden Rules of This System
- **Every entry balances (`DR = CR`):** Every debit has an equal credit. Money cannot appear or disappear.
- **No silent edits or deletions:** Posted journal entries are immutable. Mistakes are fixed only with a **Reversal** (equal-and-opposite entry) or an **Approved Adjustment**.
- **No double-counting:** Control rollups (`1000 OVA Control Account`, `2000 Merchant Obligations Control`) are display summaries only; Trial Balance totals sum only the underlying posting accounts.
- **Role-Based Access (RBAC):** `OPERATIONS`, `FINANCE`, `FINANCE_MANAGER`, `MANAGEMENT` (read-only), and `ADMIN`, with **Maker-Checker** controls on expenses and adjustments.

---

## 2. How the 9 Modules Fit Together

| Module | What It Does | Who Uses It |
| :--- | :--- | :--- |
| **1. Dashboard** | Live money-flow pipeline, Provider & Bank custody totals, Merchant Liabilities, Net PSP Revenue, Reconciliation Variance, and **Attention Required** alerts. | Management, Finance, Ops |
| **2. General Ledger** | Categorized Chart of Accounts (`Assets`, `Liabilities`, `Equity`, `Revenue`, `Expenses`), live `Assets = Liabilities + Equity + Net Income` proof, Double-Entry Journal Builder, Reversals, and clickable **Account Drill-Down** with running balances. | Finance, Finance Manager |
| **3. Provider Accounts** | Tracks MTN MoMo, Telecel Cash, AT Money, CalBank, and Ecobank accounts (`COLLECTION_OVA`, `PAYOUT_OVA`, `SETTLEMENT_ACCOUNT`), **USSD OVA Verification**, running-balance transaction history, OVA-to-Bank Liquidations, and Provider Statements. | Operations, Finance |
| **4. Merchant Accounts** | Tracks parent merchants and sub-merchants (branches), separating **Pending Settlement** from **Available Balance**, plus per-merchant sub-ledger history. | Operations, Finance |
| **5. Settlements** | Groups a merchant's pending collections into a Settlement Batch and releases funds from `Pending` → `Available` (deducting any settlement fee). | Operations (initiate), Finance (execute) |
| **6. Transaction Monitoring** | Unified search across all transactions by reference, entry #, correlation ID, or payment channel (`MTN MoMo`, `Telecel Cash`, `GhIPSS GhQR`, etc.) with a full lifecycle modal. | Operations, Finance |
| **7. Reconciliation & Exceptions** | Compares internal OVA Mirror records against imported bank/telco statements; flags `MISSING_IN_LEDGER`, `MISSING_IN_OVA`, `AMOUNT_MISMATCH`, and `BALANCE_VARIANCE` for investigation and resolution. | Operations (investigate), Finance (resolve) |
| **8. Reports & Controls** | **Daily / Weekly / Monthly** views, **Trial Balance** CSV/Excel & Print/PDF export, **Daily Closing** EOD snapshots, **Operational Expenses** (Maker-Checker), and **Adjustment Approvals**. | Finance, Finance Manager, Management |
| **9. Audit Trail** | Append-only log of every posting, verification, approval, settlement, liquidation, and reversal with actor, role, and timestamp. | Management, Finance, Admin |

---

## 3. Real-World Ghanaian PSP Case Studies

> *Note: Figures below match the clearly labeled **Sample Test Dataset** built into the application (`Load Sample Test Data` button).*

---

### Case Study 1: USSD Payment & Manual OVA Verification (MTN MoMo)
**Scenario:**  
A customer at **Makola Mart Ltd** (`MRC-SAMPLE-001`) pays **GHS 420.00** via **MTN MoMo USSD** (`USSD-MTN-2026-8801`). JuniPay's external MTN OVA portal is not yet auto-integrated via webhook.

**How the System Handles It:**
1. The payment enters **Provider Accounts → USSD OVA Verification** with status `AWAITING_OVA_VERIFICATION`. *No money is credited to the merchant or ledger yet.*
2. An **Operations** staff member logs into the external MTN OVA dashboard, confirms **GHS 420.00** arrived with MTN reference `MTN-OVA-DASH-991`, and clicks **Confirm & Post** in JuniPay Ledger.
3. The ledger automatically posts an immutable, balanced journal entry (assuming a configured fee of `GHS 6.30`):
   - **DEBIT** `1010 MTN Collections OVA (Asset)` = **GHS 420.00**
   - **CREDIT** `2110 Makola Mart — Pending Settlement (Liability)` = **GHS 413.70**
   - **CREDIT** `4000 Transaction & Settlement Fee Revenue (Revenue)` = **GHS 6.30**
4. **Result:** Total Debits (`420.00`) = Total Credits (`420.00`). Makola Mart's pending obligation increases by `GHS 413.70`, JuniPay's revenue increases by `GHS 6.30`, and the audit trail records who verified it and when.
5. *What if the customer only sent GHS 400.00 or it never arrived?* Staff clicks **Mismatch** or **Flag**, blocking fraudulent or short-paid credits from entering the ledger.

---

### Case Study 2: Multi-Branch Merchant Settlement & CalBank Payout
**Scenario:**  
**Makola Mart Ltd** has two branches (**Osu Oxford St** and **Kumasi Adum**), each tracked as a `SUB_MERCHANT` with isolated sub-ledgers. After **GHS 2,500.00** is collected for Makola Mart (`GHS 37.50` JuniPay fee, `GHS 12.50` MTN partner charge), Makola Mart requests settlement and a **GHS 1,000.00** payout to **CalBank** via **GhIPSS Instant Pay (GIP)**.

**How the System Handles It:**
1. **Collection Posting:**
   - **DEBIT** `1010 MTN Collections OVA` = `GHS 2,487.50` *(net of MTN charge)*
   - **DEBIT** `5000 Payment Partner Processing Costs` = `GHS 12.50`
   - **CREDIT** `2110 Makola Mart — Pending Settlement` = `GHS 2,462.50`
   - **CREDIT** `4000 Fee Revenue` = `GHS 37.50`
2. **Settlement Execution (Settlements Module):**
   - Finance creates and executes a settlement batch, moving `GHS 2,462.50` from `2110 Pending Settlement` → `2100 Available Balance`.
3. **Payout (`DISBURSEMENT`):**
   - JuniPay pays `GHS 1,000.00` via GhIPSS Instant Pay (`GIP-PAY-2001`). The ledger checks that `Available Balance >= 1,000.00` (preventing overdrafts), then posts:
   - **DEBIT** `2100 Makola Mart — Available Balance` = `GHS 1,000.00`
   - **CREDIT** `1010 MTN Collections OVA` = `GHS 1,000.00`
4. **Result:** Makola Mart's remaining Available Balance is accurately tracked, and **Custody Coverage** confirms JuniPay's OVA still covers 100% of merchant liabilities.

---

### Case Study 3: Catching an Unrecorded Telco Charge via Reconciliation
**Scenario:**  
At the end of the day, Finance downloads the **MTN MoMo OVA Statement** and imports it into **Provider Accounts → Provider Statements**. The statement includes a **GHS 15.00** debit (`MTN-FEE-SMP-99` — *MTN OVA monthly maintenance charge*) that JuniPay's payment system never knew about, and a **GHS 150.00** refund (`RFD-MOMO-3001`) that hasn't settled on MTN's statement yet.

**How the System Handles It:**
1. Finance/Ops clicks **Run Reconciliation Now**.
2. The reconciliation engine compares `1010 MTN Collections OVA` against the imported statement lines and automatically flags:
   - **`MISSING_IN_LEDGER`**: `MTN-FEE-SMP-99` (`-GHS 15.00`)
   - **`MISSING_IN_OVA`**: `RFD-MOMO-3001` (`-GHS 150.00`)
3. **Resolution:**
   - **Operations** marks `RFD-MOMO-3001` as `INVESTIGATING` while waiting for T+1 telco reflection.
   - For the unrecorded `GHS 15.00` fee, Finance submits an **Adjustment Request** (`DEBIT 5000 Partner Costs 15.00 / CREDIT 1010 MTN OVA 15.00`), gets **Finance Manager** approval, and marks the discrepancy `RESOLVED`.
4. **Result:** Every cedi of variance between JuniPay's OVA Mirror and MTN's statement is explained and audited.

---

### Case Study 4: Operational Expense with Maker-Checker Control
**Scenario:**  
Operations needs to pay **GHS 120.00** from `OVA_MAIN` to **Hubtel / SMS Gateway Ghana** for monthly USSD/SMS gateway bundles (`EXP-SMP-2026-01`).

**How the System Handles It:**
1. **Maker (`OPERATIONS`):** Submits the expense in **Reports & Controls → Operational Expenses** with category `INFRASTRUCTURE`, purpose, destination, and source account. Status is `PENDING_APPROVAL`—no funds are deducted in the GL yet.
2. **Checker (`FINANCE_MANAGER`):** Reviews the request. If the same person tries to approve their own expense, the system blocks it (`403 Forbidden`). A different Finance Manager approves it.
3. **Ledger Posting:** On approval, the system automatically posts:
   - **DEBIT** `5100 Operational & Administrative Expenses` = `GHS 120.00`
   - **CREDIT** `1010 MTN Collections OVA` = `GHS 120.00`
4. **Result:** Net PSP Revenue reflects the expense (`Fee Revenue − Partner Costs − Operational Expenses`), and the Audit Trail records both maker and checker.

---

## 4. Quick Reference: Running the System

1. **Start Backend (FastAPI):**
   ```powershell
   cd backend
   .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
   ```
2. **Start Frontend (React + TypeScript + Tailwind CSS):**
   ```powershell
   cd frontend
   npm run dev
   ```
3. **Open:** `http://localhost:5173`, click **Load Sample Test Data** in the sidebar, and use the **Internal Staff Role** selector (`OPERATIONS`, `FINANCE`, `FINANCE_MANAGER`, `MANAGEMENT`, `ADMIN`) or press `Ctrl+K` to jump to any module.
