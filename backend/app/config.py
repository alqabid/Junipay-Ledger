from typing import Any, Literal
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application configuration.
    Separates infrastructure settings from configurable JuniPay integration assumptions.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "JuniPay Financial Ledger MVP"
    api_prefix: str = "/api/v1"

    # Database: PostgreSQL in production/staging; SQLite fallback for local MVP testing
    database_url: str = "sqlite:///./junipay_ledger.db"

    # Configurable Assumptions (to be aligned with live JuniPay core configuration)
    default_currency: str = "GHS"
    # Determines whether incoming COLLECTION events credit MERCHANT_PENDING or MERCHANT_AVAILABLE
    settlement_default_hold_mode: Literal["PENDING", "AVAILABLE"] = "PENDING"
    # Fee behavior: caller-provided in event payload (recommended) or 0 if omitted
    default_collection_fee_rate_bps: int = 0  # Basis points (0 = do not invent fees)
    # Webhook HMAC verification
    webhook_hmac_secret: str = "dev-junipay-ledger-secret"
    allow_unsigned_dev_events: bool = True
    # Sample data seeding (explicitly disabled by default unless requested)
    auto_seed_sample_data: bool = False

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    cors_origin_regex: str | None = r"https://.*\.vercel\.app"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                return json.loads(v)
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


settings = Settings()
