from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.routers import audit, dashboard, expenses, integrations, ledger, merchants, ova, reconciliation, reports, settlements, transactions, ussd
from app.services.ledger_service import ensure_system_accounts
from app.services.seed_service import seed_sample_data


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_system_accounts(db, currency=settings.default_currency)
        if settings.auto_seed_sample_data:
            seed_sample_data(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0-mvp",
    description="Double-entry Financial Ledger, OVA Mirror, Settlement & Reconciliation Module for JuniPay.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router, prefix=settings.api_prefix)
app.include_router(ledger.router, prefix=settings.api_prefix)
app.include_router(merchants.router, prefix=settings.api_prefix)
app.include_router(ova.router, prefix=settings.api_prefix)
app.include_router(settlements.router, prefix=settings.api_prefix)
app.include_router(transactions.router, prefix=settings.api_prefix)
app.include_router(ussd.router, prefix=settings.api_prefix)
app.include_router(expenses.router, prefix=settings.api_prefix)
app.include_router(reconciliation.router, prefix=settings.api_prefix)
app.include_router(reports.router, prefix=settings.api_prefix)
app.include_router(integrations.router, prefix=settings.api_prefix)
app.include_router(audit.router, prefix=settings.api_prefix)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": settings.app_name}
