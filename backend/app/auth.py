from dataclasses import dataclass
from typing import Literal
from fastapi import Header, HTTPException, status

RoleType = Literal["OPERATIONS", "FINANCE", "FINANCE_MANAGER", "MANAGEMENT", "ADMIN"]
VALID_ROLES: set[str] = {"OPERATIONS", "FINANCE", "FINANCE_MANAGER", "MANAGEMENT", "ADMIN"}


@dataclass
class ActorContext:
    actor_id: str
    role: RoleType


def get_actor_context(
    x_junipay_role: str = Header(default="FINANCE"),
    x_junipay_actor: str = Header(default="INTERNAL_STAFF"),
) -> ActorContext:
    role_upper = x_junipay_role.strip().upper()
    if role_upper not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Invalid internal role '{x_junipay_role}'. Allowed: {', '.join(sorted(VALID_ROLES))}.",
        )
    return ActorContext(actor_id=x_junipay_actor.strip() or "INTERNAL_STAFF", role=role_upper)  # type: ignore[arg-type]


def require_role(*allowed_roles: RoleType):
    def _dependency(
        x_junipay_role: str = Header(default="FINANCE"),
        x_junipay_actor: str = Header(default="INTERNAL_STAFF"),
    ) -> ActorContext:
        ctx = get_actor_context(x_junipay_role=x_junipay_role, x_junipay_actor=x_junipay_actor)
        if ctx.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{ctx.role}' is not permitted for this action. Required: {', '.join(allowed_roles)}.",
            )
        return ctx

    return _dependency
