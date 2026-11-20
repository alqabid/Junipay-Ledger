from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant, OperationalExpense, UssdVerification
from app.schemas import (
    JuniPayTransactionEvent,
    OvaAccountCreate,
    OvaLiquidationCreate,
    OvaStatementIngest,
    OvaSyncRequest,
    SettlementBatchCreate,
)
from app.services.integration_service import process_junipay_event
from app.services.ledger_service import ensure_merchant_accounts, ensure_system_accounts
from app.services.ova_service import create_liquidation, create_ova_account, sync_ova_provider_balance
from app.services.reconciliation_service import ingest_ova_statement, run_reconciliation
from app.services.settlement_service import create_settlement_batch, settle_batch


def seed_sample_data(db: Session) -> dict:
    """
    Populate clearly labeled SAMPLE / ILLUSTRATIVE Ghanaian PSP test data
    (Ghanaian telcos, banks, GhIPSS, and merchants in GHS) for initial MVP testing.
    Idempotent: skips if sample merchants already exist.
    """
    ensure_system_accounts(db, currency="GHS")

    existing = db.scalar(select(Merchant).where(Merchant.external_merchant_id == "MRC-SAMPLE-001"))
    if existing:
        return {"seeded": False, "message": "Sample test data already present."}

    # 1. Provision Ghanaian Provider OVAs & Settlement Bank Accounts (Sample)
    create_ova_account(
        db,
        OvaAccountCreate(
            code="OVA_TELECEL",
            provider_code="TELECEL_CASH",
            provider_name="Telecel Cash Collections OVA (Sample)",
            account_type="COLLECTION_OVA",
            account_number_masked="****-TLC-GH02",
            currency="GHS",
        ),
        actor_id="SAMPLE_SEEDER",
    )
    create_ova_account(
        db,
        OvaAccountCreate(
            code="OVA_AT_MONEY",
            provider_code="AT_MONEY",
            provider_name="AT Money Collections OVA (Sample)",
            account_type="COLLECTION_OVA",
            account_number_masked="****-ATM-GH03",
            currency="GHS",
        ),
        actor_id="SAMPLE_SEEDER",
    )
    create_ova_account(
        db,
        OvaAccountCreate(
            code="OVA_BANK_SETTLE",
            provider_code="CALBANK_GH",
            provider_name="CalBank Settlement Account (Sample)",
            account_type="SETTLEMENT_ACCOUNT",
            account_number_masked="****-CAL-4410",
            currency="GHS",
        ),
        actor_id="SAMPLE_SEEDER",
    )
    create_ova_account(
        db,
        OvaAccountCreate(
            code="OVA_ECOBANK_SETTLE",
            provider_code="ECOBANK_GH",
            provider_name="Ecobank GhIPSS Clearing Account (Sample)",
            account_type="SETTLEMENT_ACCOUNT",
            account_number_masked="****-ECO-7720",
            currency="GHS",
        ),
        actor_id="SAMPLE_SEEDER",
    )

    # 2. Create sample Ghanaian Parent Merchants & Sub-Merchants
    parent = Merchant(
        external_merchant_id="MRC-SAMPLE-001",
        name="Makola Mart Ltd (Sample Merchant)",
        merchant_type="MERCHANT",
        settlement_schedule="T+1 (Configurable)",
        default_currency="GHS",
        metadata_json={"is_sample": True, "city": "Accra", "bank": "CalBank"},
    )
    merchant2 = Merchant(
        external_merchant_id="MRC-SAMPLE-002",
        name="AccraGo Pharmacy & Logistics (Sample Merchant)",
        merchant_type="MERCHANT",
        settlement_schedule="T+1 (Configurable)",
        default_currency="GHS",
        metadata_json={"is_sample": True, "city": "Tema", "bank": "Ecobank Ghana"},
    )
    db.add_all([parent, merchant2])
    db.flush()
    ensure_merchant_accounts(db, parent)
    ensure_merchant_accounts(db, merchant2)

    sub1 = Merchant(
        external_merchant_id="SUB-SAMPLE-001A",
        parent_merchant_id=parent.id,
        name="Makola Mart — Osu Oxford St (Sample Sub-Merchant)",
        merchant_type="SUB_MERCHANT",
        settlement_schedule="T+1 (Configurable)",
        default_currency="GHS",
        metadata_json={"is_sample": True, "branch": "Osu"},
    )
    sub2 = Merchant(
        external_merchant_id="SUB-SAMPLE-001B",
        parent_merchant_id=parent.id,
        name="Makola Mart — Kumasi Adum (Sample Sub-Merchant)",
        merchant_type="SUB_MERCHANT",
        settlement_schedule="T+1 (Configurable)",
        default_currency="GHS",
        metadata_json={"is_sample": True, "branch": "Kumasi Adum"},
    )
    db.add_all([sub1, sub2])
    db.flush()
    ensure_merchant_accounts(db, sub1)
    ensure_merchant_accounts(db, sub2)
    db.commit()

    # 3. Sample Ghanaian Collections across MTN MoMo, Telecel Cash, AT Money & GhIPSS
    events = [
        JuniPayTransactionEvent(
            idempotency_key="sample-col-001",
            event_type="COLLECTION",
            external_reference="MOMO-SMP-1001",
            correlation_id="CORR-GH-01",
            external_merchant_id="MRC-SAMPLE-001",
            ova_code="OVA_MAIN",
            gross_amount=Decimal("2500.00"),
            fee_amount=Decimal("37.50"),
            partner_fee_amount=Decimal("12.50"),
            currency="GHS",
            hold_mode="PENDING",
            description="Sample collection: MTN MoMo checkout (Makola Mart)",
            metadata={"is_sample": True, "channel": "MTN MoMo"},
        ),
        JuniPayTransactionEvent(
            idempotency_key="sample-col-002",
            event_type="COLLECTION",
            external_reference="TLC-SMP-1002",
            correlation_id="CORR-GH-02",
            external_merchant_id="SUB-SAMPLE-001A",
            ova_code="OVA_TELECEL",
            gross_amount=Decimal("1200.00"),
            fee_amount=Decimal("18.00"),
            partner_fee_amount=Decimal("6.00"),
            currency="GHS",
            hold_mode="PENDING",
            description="Sample collection: Telecel Cash USSD (Osu Oxford St)",
            metadata={"is_sample": True, "channel": "Telecel Cash"},
        ),
        JuniPayTransactionEvent(
            idempotency_key="sample-col-003",
            event_type="COLLECTION",
            external_reference="GHQR-SMP-1003",
            correlation_id="CORR-GH-03",
            external_merchant_id="SUB-SAMPLE-001B",
            ova_code="OVA_MAIN",
            gross_amount=Decimal("850.00"),
            fee_amount=Decimal("12.75"),
            currency="GHS",
            hold_mode="PENDING",
            description="Sample collection: GhIPSS GhQR payment (Kumasi Adum)",
            metadata={"is_sample": True, "channel": "GhIPSS GhQR"},
        ),
        JuniPayTransactionEvent(
            idempotency_key="sample-col-004",
            event_type="COLLECTION",
            external_reference="ATM-SMP-1004",
            correlation_id="CORR-GH-04",
            external_merchant_id="MRC-SAMPLE-002",
            ova_code="OVA_AT_MONEY",
            gross_amount=Decimal("1650.00"),
            fee_amount=Decimal("24.75"),
            currency="GHS",
            hold_mode="PENDING",
            description="Sample collection: AT Money wallet payment (AccraGo)",
            metadata={"is_sample": True, "channel": "AT Money"},
        ),
    ]
    for ev in events:
        process_junipay_event(db, ev)

    # 4. Settle Makola Mart Ltd so it has Available Balance, then do a CalBank Payout & Refund
    batch_parent = create_settlement_batch(
        db,
        SettlementBatchCreate(
            external_merchant_id="MRC-SAMPLE-001",
            currency="GHS",
            fee_amount=Decimal("0.00"),
            external_payout_ref="CAL-STL-SMP-01",
        ),
    )
    settle_batch(db, batch_parent.id, actor_id="SAMPLE_SEEDER")

    # Create a PENDING settlement batch for Osu Oxford St (awaiting settlement execution)
    create_settlement_batch(
        db,
        SettlementBatchCreate(
            external_merchant_id="SUB-SAMPLE-001A",
            currency="GHS",
            fee_amount=Decimal("5.00"),
            external_payout_ref="ECO-STL-SMP-02",
        ),
    )

    # Sample Disbursement (Payout to CalBank via GhIPSS Instant Pay)
    process_junipay_event(
        db,
        JuniPayTransactionEvent(
            idempotency_key="sample-disb-001",
            event_type="DISBURSEMENT",
            external_reference="GIP-PAY-2001",
            correlation_id="CORR-GH-05",
            external_merchant_id="MRC-SAMPLE-001",
            ova_code="OVA_MAIN",
            gross_amount=Decimal("1000.00"),
            currency="GHS",
            description="Sample merchant payout via GhIPSS Instant Pay (CalBank)",
            metadata={"is_sample": True, "rail": "GhIPSS GIP"},
        ),
    )

    # Sample Refund on Makola Mart
    process_junipay_event(
        db,
        JuniPayTransactionEvent(
            idempotency_key="sample-ref-001",
            event_type="REFUND",
            external_reference="RFD-MOMO-3001",
            correlation_id="CORR-GH-06",
            external_merchant_id="MRC-SAMPLE-001",
            ova_code="OVA_MAIN",
            gross_amount=Decimal("150.00"),
            fee_amount=Decimal("0.00"),
            currency="GHS",
            hold_mode="AVAILABLE",
            description="Sample customer MoMo refund",
            metadata={"is_sample": True},
        ),
    )

    # 5. Ingest Provider Statement Entries (matching most, plus intentional sample discrepancies)
    ova_statements = [
        OvaStatementIngest(
            ova_code="OVA_MAIN",
            external_tx_ref="MOMO-SMP-1001",
            direction="CREDIT",
            amount=Decimal("2487.50"),
            currency="GHS",
            narration="MTN MoMo Inflow MOMO-SMP-1001 (net of telco charge)",
        ),
        OvaStatementIngest(
            ova_code="OVA_MAIN",
            external_tx_ref="GHQR-SMP-1003",
            direction="CREDIT",
            amount=Decimal("850.00"),
            currency="GHS",
            narration="GhIPSS GhQR Inflow GHQR-SMP-1003",
        ),
        OvaStatementIngest(
            ova_code="OVA_MAIN",
            external_tx_ref="GIP-PAY-2001",
            direction="DEBIT",
            amount=Decimal("1000.00"),
            currency="GHS",
            narration="GhIPSS Payout GIP-PAY-2001",
        ),
        # Intentional sample discrepancy: RFD-MOMO-3001 missing from telco statement, plus unrecorded telco fee
        OvaStatementIngest(
            ova_code="OVA_MAIN",
            external_tx_ref="MTN-FEE-SMP-99",
            direction="DEBIT",
            amount=Decimal("15.00"),
            currency="GHS",
            narration="Unrecorded MTN OVA monthly maintenance charge (Sample Discrepancy)",
        ),
    ]
    for st in ova_statements:
        ingest_ova_statement(db, st)

    run_reconciliation(db, ova_code="OVA_MAIN", executed_by="SAMPLE_SEEDER")

    # 6. Sync sample provider-reported balances & initiate a sample liquidation to CalBank
    sync_ova_provider_balance(
        db,
        "OVA_MAIN",
        OvaSyncRequest(provider_reported_balance=Decimal("2322.50"), sync_status="SYNCED"),
        actor_id="SAMPLE_SEEDER",
    )
    sync_ova_provider_balance(
        db,
        "OVA_TELECEL",
        OvaSyncRequest(provider_reported_balance=Decimal("1194.00"), sync_status="SYNCED"),
        actor_id="SAMPLE_SEEDER",
    )
    create_liquidation(
        db,
        OvaLiquidationCreate(
            source_ova_code="OVA_MAIN",
            destination_ova_code="OVA_BANK_SETTLE",
            gross_amount=Decimal("500.00"),
            provider_fee_amount=Decimal("2.50"),
            external_transfer_ref="CAL-LIQ-SMP-9001",
            notes="Sample OVA sweep from MTN MoMo to CalBank Settlement Account",
        ),
        actor_id="SAMPLE_SEEDER",
    )

    # 7. Sample USSD payments awaiting manual OVA dashboard verification
    db.add_all(
        [
            UssdVerification(
                ussd_session_ref="USSD-MTN-2026-8801",
                provider_code="MTN_MOMO",
                ova_code="OVA_MAIN",
                external_merchant_id="MRC-SAMPLE-001",
                customer_msisdn_masked="024***4812",
                expected_amount=Decimal("420.00"),
                fee_amount=Decimal("6.30"),
                currency="GHS",
                status="AWAITING_OVA_VERIFICATION",
            ),
            UssdVerification(
                ussd_session_ref="USSD-TLC-2026-8802",
                provider_code="TELECEL_CASH",
                ova_code="OVA_TELECEL",
                external_merchant_id="SUB-SAMPLE-001A",
                customer_msisdn_masked="020***1904",
                expected_amount=Decimal("185.00"),
                fee_amount=Decimal("2.75"),
                currency="GHS",
                status="AWAITING_OVA_VERIFICATION",
            ),
        ]
    )
    # Sample operational expense awaiting maker-checker approval
    db.add(
        OperationalExpense(
            expense_ref="EXP-SMP-2026-01",
            category="INFRASTRUCTURE",
            purpose="Sample SMS & USSD gateway monthly bundle",
            destination="Hubtel / SMS Gateway Ghana (Sample)",
            source_ova_code="OVA_MAIN",
            amount=Decimal("120.00"),
            currency="GHS",
            status="PENDING_APPROVAL",
            initiated_by="OPS_STAFF (OPERATIONS)",
        )
    )
    db.commit()

    return {"seeded": True, "message": "Ghanaian PSP sample test data initialized."}
