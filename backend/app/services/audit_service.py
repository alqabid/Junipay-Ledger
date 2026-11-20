from typing import Any, Optional
from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit_log(
    db: Session,
    *,
    actor_id: str,
    actor_type: str,
    action: str,
    resource_type: str,
    resource_id: str,
    correlation_id: Optional[str] = None,
    previous_state: Optional[dict[str, Any]] = None,
    new_state: Optional[dict[str, Any]] = None,
) -> AuditLog:
    """Append an immutable audit log entry inside the current DB transaction."""
    log = AuditLog(
        actor_id=actor_id,
        actor_type=actor_type,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        correlation_id=correlation_id,
        previous_state=previous_state,
        new_state=new_state,
    )
    db.add(log)
    return log
