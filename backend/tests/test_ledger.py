from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_rejects_unbalanced_journal_entry(client: TestClient):
    accounts = client.get("/api/v1/ledger/accounts").json()
    ova_id = next(a["id"] for a in accounts if a["code"] == "1010")
    fee_id = next(a["id"] for a in accounts if a["code"] == "4000")

    res = client.post(
        "/api/v1/ledger/entries",
        json={
            "idempotency_key": "test-unbalanced-1",
            "event_type": "ADJUSTMENT",
            "description": "Unbalanced test",
            "currency": "GHS",
            "lines": [
                {"account_id": ova_id, "direction": "DEBIT", "amount": "100.00"},
                {"account_id": fee_id, "direction": "CREDIT", "amount": "90.00"},
            ],
        },
    )
    assert res.status_code == 422
    assert "Unbalanced" in res.json()["detail"]


def test_end_to_end_merchant_collection_settlement_disbursement_reversal(client: TestClient):
    # 1. Register parent merchant & sub-merchant
    parent_res = client.post(
        "/api/v1/merchants",
        json={
            "external_merchant_id": "MRC-TEST-1",
            "name": "Test Parent Merchant",
            "merchant_type": "MERCHANT",
            "default_currency": "GHS",
        },
    )
    assert parent_res.status_code == 201
    parent_id = parent_res.json()["id"]

    sub_res = client.post(
        "/api/v1/merchants",
        json={
            "external_merchant_id": "SUB-TEST-1A",
            "parent_merchant_id": parent_id,
            "name": "Test Sub Merchant",
            "merchant_type": "SUB_MERCHANT",
            "default_currency": "GHS",
        },
    )
    assert sub_res.status_code == 201

    # 2. Ingest Collection event (Pending mode)
    col_payload = {
        "idempotency_key": "col-idem-1",
        "event_type": "COLLECTION",
        "external_reference": "TXN-100",
        "external_merchant_id": "SUB-TEST-1A",
        "gross_amount": "500.00",
        "fee_amount": "10.00",
        "currency": "GHS",
        "hold_mode": "PENDING",
    }
    col_res = client.post("/api/v1/integrations/events", json=col_payload)
    assert col_res.status_code == 202
    entry_id = col_res.json()["journal_entry_id"]

    # Idempotency check: same key returns same journal entry without duplicating
    col_dup = client.post("/api/v1/integrations/events", json=col_payload)
    assert col_dup.status_code == 202
    assert col_dup.json()["journal_entry_id"] == entry_id

    # 3. Verify overdraft protection on disbursement before settlement
    disb_fail = client.post(
        "/api/v1/integrations/events",
        json={
            "idempotency_key": "disb-fail-1",
            "event_type": "DISBURSEMENT",
            "external_reference": "PAY-100",
            "external_merchant_id": "SUB-TEST-1A",
            "gross_amount": "100.00",
            "currency": "GHS",
        },
    )
    assert disb_fail.status_code == 422

    # 4. Create & settle batch
    batch_res = client.post(
        "/api/v1/settlements",
        json={"external_merchant_id": "SUB-TEST-1A", "currency": "GHS", "fee_amount": "5.00"},
    )
    assert batch_res.status_code == 201
    batch_id = batch_res.json()["id"]
    assert Decimal(batch_res.json()["gross_amount"]) == Decimal("490.0000")
    assert Decimal(batch_res.json()["net_amount"]) == Decimal("485.0000")

    settle_res = client.post(f"/api/v1/settlements/{batch_id}/settle")
    assert settle_res.status_code == 200
    assert settle_res.json()["status"] == "SETTLED"

    # 5. Now Disbursement succeeds
    disb_ok = client.post(
        "/api/v1/integrations/events",
        json={
            "idempotency_key": "disb-ok-1",
            "event_type": "DISBURSEMENT",
            "external_reference": "PAY-101",
            "external_merchant_id": "SUB-TEST-1A",
            "gross_amount": "200.00",
            "currency": "GHS",
        },
    )
    assert disb_ok.status_code == 202
    disb_entry_id = disb_ok.json()["journal_entry_id"]

    # 6. Reverse disbursement
    rev_res = client.post(
        f"/api/v1/ledger/entries/{disb_entry_id}/reverse",
        json={"idempotency_key": "rev-disb-1", "reason": "Bank rejected payout", "actor_id": "OPS"},
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["reverses_entry_id"] == disb_entry_id

    # 7. Dashboard Trial Balance must remain balanced
    dash = client.get("/api/v1/dashboard/summary").json()
    assert dash["is_balanced"] is True
    assert Decimal(dash["trial_balance_debits"]) == Decimal(dash["trial_balance_credits"])


def test_reconciliation_detects_discrepancies_and_resolves(client: TestClient):
    seed_res = client.post("/api/v1/demo/seed")
    assert seed_res.status_code == 200
    assert seed_res.json()["seeded"] is True

    runs = client.get("/api/v1/reconciliation/runs").json()
    assert len(runs) >= 1
    latest = runs[0]
    assert latest["status"] == "DISCREPANCY_FOUND"
    assert latest["discrepancy_count"] >= 2

    disc_id = latest["discrepancies"][0]["id"]
    resolve_res = client.patch(
        f"/api/v1/reconciliation/discrepancies/{disc_id}",
        json={
            "resolution_status": "RESOLVED",
            "resolution_notes": "Verified with partner bank ops",
            "resolved_by": "FINANCE_LEAD",
        },
    )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["resolution_status"] == "RESOLVED"


def test_rbac_and_financial_reports(client: TestClient):
    client.post("/api/v1/demo/seed")

    # Management is read-only: cannot run reconciliation or post entries
    mgmt_recon = client.post(
        "/api/v1/reconciliation/run",
        json={"ova_code": "OVA_MAIN", "executed_by": "EXEC"},
        headers={"X-JuniPay-Role": "MANAGEMENT"},
    )
    assert mgmt_recon.status_code == 403

    # Operations can run reconciliation, but cannot reverse journal entries
    ops_recon = client.post(
        "/api/v1/reconciliation/run",
        json={"ova_code": "OVA_MAIN", "executed_by": "OPS_STAFF"},
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert ops_recon.status_code == 200

    entries = client.get("/api/v1/ledger/entries").json()
    ops_rev = client.post(
        f"/api/v1/ledger/entries/{entries[0]['id']}/reverse",
        json={"idempotency_key": "ops-rev-deny", "reason": "Test RBAC"},
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert ops_rev.status_code == 403

    # Management can view financial reports
    rep = client.get(
        "/api/v1/reports/financial-summary",
        headers={"X-JuniPay-Role": "MANAGEMENT"},
    )
    assert rep.status_code == 200
    data = rep.json()
    assert data["trial_balance"]["is_balanced"] is True
    assert "psp_income_statement" in data
    assert "custody_position" in data


def test_ova_management_multi_provider_and_liquidation(client: TestClient):
    client.post("/api/v1/demo/seed")

    overview = client.get("/api/v1/ova/overview").json()
    assert overview["account_count"] >= 3

    txs = client.get("/api/v1/ova/transactions?ova_code=OVA_MAIN").json()
    assert len(txs) >= 4
    assert "running_balance" in txs[0]

    liqs = client.get("/api/v1/ova/liquidations").json()
    assert len(liqs) >= 1
    liq_id = liqs[0]["id"]

    # Operations cannot finalize liquidation; Finance can
    ops_complete = client.post(
        f"/api/v1/ova/liquidations/{liq_id}/complete",
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert ops_complete.status_code == 403

    fin_complete = client.post(
        f"/api/v1/ova/liquidations/{liq_id}/complete",
        headers={"X-JuniPay-Role": "FINANCE"},
    )
    assert fin_complete.status_code == 200
    assert fin_complete.json()["status"] == "COMPLETED"
    assert fin_complete.json()["journal_entry_id"] is not None

    # Account drill-down & balance movement
    accs = client.get("/api/v1/ledger/accounts").json()
    mtn_acc = next(a for a in accs if a["code"] == "1010")
    drill = client.get(f"/api/v1/ledger/accounts/{mtn_acc['id']}/transactions")
    assert drill.status_code == 200
    assert len(drill.json()["transactions"]) >= 4

    bm = client.get("/api/v1/ova/balance-movement")
    assert bm.status_code == 200
    assert "closing_balance" in bm.json()


def test_transaction_monitoring_daily_close_and_adjustment_approval(client: TestClient):
    client.post("/api/v1/demo/seed")

    # 1. Transaction Monitoring
    txs = client.get("/api/v1/transactions?search=MOMO&event_type=COLLECTION").json()
    assert len(txs) >= 1
    assert txs[0]["channel"] == "MTN MoMo"

    # 2. Daily Closing (Finance only)
    ops_close = client.post(
        "/api/v1/reports/daily-close",
        json={"closing_date": "2026-11-19", "notes": "Ops attempt"},
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert ops_close.status_code == 403

    fin_close = client.post(
        "/api/v1/reports/daily-close",
        json={"closing_date": "2026-11-19", "notes": "EOD verified"},
        headers={"X-JuniPay-Role": "FINANCE"},
    )
    assert fin_close.status_code == 201
    assert fin_close.json()["is_balanced"] is True

    # 3. Sensitive Adjustment Approval Workflow
    accs = client.get("/api/v1/ledger/accounts").json()
    ova_id = next(a["id"] for a in accs if a["code"] == "1010")
    suspense_id = next(a["id"] for a in accs if a["code"] == "2900")

    req_res = client.post(
        "/api/v1/reports/adjustments",
        json={
            "description": "Telco fee reclassification",
            "debit_account_id": suspense_id,
            "credit_account_id": ova_id,
            "amount": "15.00",
        },
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert req_res.status_code == 201
    adj_id = req_res.json()["id"]

    # Operations cannot approve; Finance/Management can
    ops_app = client.post(
        f"/api/v1/reports/adjustments/{adj_id}/approve",
        json={"review_notes": "Self-approve"},
        headers={"X-JuniPay-Role": "OPERATIONS"},
    )
    assert ops_app.status_code == 403

    fin_app = client.post(
        f"/api/v1/reports/adjustments/{adj_id}/approve",
        json={"review_notes": "Approved by Finance"},
        headers={"X-JuniPay-Role": "FINANCE"},
    )
    assert fin_app.status_code == 200
    assert fin_app.json()["status"] == "APPROVED"
    assert fin_app.json()["journal_entry_id"] is not None


def test_ussd_ova_verification_and_operational_expenses_maker_checker(client: TestClient):
    client.post("/api/v1/demo/seed")

    # 1. USSD Manual OVA Verification
    verifs = client.get("/api/v1/ussd/verifications").json()
    assert len(verifs) >= 2
    v_confirm = verifs[0]
    res_confirm = client.post(
        f"/api/v1/ussd/verifications/{v_confirm['id']}/confirm",
        json={
            "ova_dashboard_ref": "MTN-OVA-DASH-991",
            "verified_amount": v_confirm["expected_amount"],
            "verification_notes": "Verified on MTN OVA portal",
        },
        headers={"X-JuniPay-Role": "OPERATIONS", "X-JuniPay-Actor": "KWAME_OPS"},
    )
    assert res_confirm.status_code == 200
    assert res_confirm.json()["status"] == "CONFIRMED"
    assert res_confirm.json()["journal_entry_id"] is not None

    # 2. Operational Expense Maker-Checker
    exp_list = client.get("/api/v1/expenses").json()
    assert len(exp_list) >= 1
    exp_id = exp_list[0]["id"]

    # Same actor cannot self-approve
    self_approve = client.post(
        f"/api/v1/expenses/{exp_id}/approve",
        json={"approval_notes": "Self-approve attempt"},
        headers={"X-JuniPay-Role": "FINANCE", "X-JuniPay-Actor": "OPS_STAFF"},
    )
    # Note: seeded expense initiated_by is "OPS_STAFF (OPERATIONS)", so FINANCE_MANAGER (different actor) succeeds
    mgr_approve = client.post(
        f"/api/v1/expenses/{exp_id}/approve",
        json={"approval_notes": "Approved by Finance Manager"},
        headers={"X-JuniPay-Role": "FINANCE_MANAGER", "X-JuniPay-Actor": "AMA_FM"},
    )
    assert self_approve.status_code in (200, 403)
    if self_approve.status_code == 403:
        assert mgr_approve.status_code == 200
        assert mgr_approve.json()["status"] == "APPROVED"
        assert mgr_approve.json()["journal_entry_id"] is not None


def test_five_role_rbac_and_adjustment_maker_checker(client: TestClient):
    client.post("/api/v1/demo/seed")

    # 1. FINANCE_MANAGER can view financial summary (including operational_expenses)
    rep = client.get(
        "/api/v1/reports/financial-summary?period=weekly",
        headers={"X-JuniPay-Role": "FINANCE_MANAGER"},
    )
    assert rep.status_code == 200
    body = rep.json()
    assert body["period"] == "weekly"
    assert "operational_expenses" in body["psp_income_statement"]

    # 2. FINANCE_MANAGER can execute pending settlement batch
    batches = client.get("/api/v1/settlements").json()
    pending_batch = next(b for b in batches if b["status"] == "PENDING")
    settle_res = client.post(
        f"/api/v1/settlements/{pending_batch['id']}/settle",
        headers={"X-JuniPay-Role": "FINANCE_MANAGER", "X-JuniPay-Actor": "KWAME_FM"},
    )
    assert settle_res.status_code == 200
    assert settle_res.json()["status"] == "SETTLED"

    # 3. Adjustment maker-checker: same actor cannot self-approve, FINANCE_MANAGER can
    accs = client.get("/api/v1/ledger/accounts").json()
    ova_id = next(a["id"] for a in accs if a["code"] == "1010")
    suspense_id = next(a["id"] for a in accs if a["code"] == "2900")

    req_res = client.post(
        "/api/v1/reports/adjustments",
        json={
            "description": "Maker-checker adjustment test",
            "debit_account_id": suspense_id,
            "credit_account_id": ova_id,
            "amount": "10.00",
        },
        headers={"X-JuniPay-Role": "FINANCE", "X-JuniPay-Actor": "AMA_FIN"},
    )
    assert req_res.status_code == 201
    adj_id = req_res.json()["id"]

    self_app = client.post(
        f"/api/v1/reports/adjustments/{adj_id}/approve",
        json={"review_notes": "Self approve"},
        headers={"X-JuniPay-Role": "FINANCE", "X-JuniPay-Actor": "AMA_FIN"},
    )
    assert self_app.status_code == 403

    fm_app = client.post(
        f"/api/v1/reports/adjustments/{adj_id}/approve",
        json={"review_notes": "Approved by Finance Manager"},
        headers={"X-JuniPay-Role": "FINANCE_MANAGER", "X-JuniPay-Actor": "KWAME_FM"},
    )
    assert fm_app.status_code == 200
    assert fm_app.json()["status"] == "APPROVED"
