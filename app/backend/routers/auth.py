"""
Auth Router - user accounts, sessions, invites and password resets

Endpoints:
  POST   /api/auth/login                  - Log in with email + password
  POST   /api/auth/logout                 - End the session
  GET    /api/auth/me                     - Current user, role and organisation
  GET    /api/auth/status                 - Lightweight auth check
  PATCH  /api/auth/me                     - Update own name
  POST   /api/auth/change-password        - Change own password
  POST   /api/auth/request-password-reset - Email a reset link (always 200)
  POST   /api/auth/reset-password         - Set a new password from a reset token
  GET    /api/auth/invites/lookup         - Public: validate an invite token
  POST   /api/auth/accept-invite          - Create an account from an invite
  GET    /api/auth/invites                - Admin: list open invites
  POST   /api/auth/invites                - Admin: invite a user (email + role)
  POST   /api/auth/invites/{id}/resend    - Admin: regenerate + resend an invite
  DELETE /api/auth/invites/{id}           - Admin: revoke an invite
  GET    /api/auth/users                  - Admin: list users
  PATCH  /api/auth/users/{id}             - Admin: change role / (de)activate
"""

from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Response, Request, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlmodel import col

from auth import (
    INVITE_MAX_AGE,
    PASSWORD_RESET_MAX_AGE,
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    Principal,
    create_user_session,
    enforce_rate_limit,
    generate_token,
    get_current_principal,
    get_token_candidates,
    hash_password,
    hash_token,
    login_rate_limiter,
    password_needs_rehash,
    require_admin_role,
    require_user,
    reset_rate_limiter,
    revoke_user_sessions,
    validate_new_password,
    verify_password,
)
from config import settings
from database.connection import get_db
from dependencies import get_current_organisation
from models import (
    Invite,
    InviteRead,
    Organisation,
    User,
    UserRead,
    UserRole,
    UserSession,
)
from services.email import send_invite_email, send_password_reset_email

router = APIRouter()


# ============================================================================
# Request/response models
# ============================================================================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RequestPasswordResetRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class InviteCreate(BaseModel):
    email: EmailStr
    role: UserRole


class AcceptInviteRequest(BaseModel):
    token: str
    first_name: str
    last_name: Optional[str] = None
    password: str


class UserAdminUpdate(BaseModel):
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


# ============================================================================
# Helpers
# ============================================================================

def _set_session_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=max_age,
        httponly=True,
        samesite="none" if settings.is_production else "lax",
        secure=settings.is_production,
        path="/",
    )


def _user_payload(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": UserRole(user.role).value,
    }


def _org_payload(org: Organisation) -> dict[str, Any]:
    return {"id": org.id, "name": org.name, "slug": org.slug}


def _invite_url(org: Organisation, token: str) -> str:
    return f"{settings.frontend_url_for(org.slug)}/accept-invite?token={token}"


def _find_open_invite(db: Session, token: str) -> Optional[Invite]:
    """An invite that is unused and unexpired, by raw token."""
    invite = db.query(Invite).filter(Invite.token_hash == hash_token(token)).first()
    if not invite or invite.accepted_at is not None or invite.expires_at < datetime.utcnow():
        return None
    return invite  # type: ignore[no-any-return]


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return str(forwarded.split(",")[0].strip())
    return str(request.client.host) if request.client else "unknown"


# ============================================================================
# Sessions
# ============================================================================

@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
) -> dict[str, Any]:
    """
    Log in with email + password.

    The organisation is determined from the request hostname / X-Org-Slug.
    """
    email = body.email.lower()
    enforce_rate_limit(login_rate_limiter, f"login:{_client_ip(request)}:{email}")

    user = db.query(User).filter(
        User.organisation_id == org.id,
        func.lower(User.email) == email,
    ).first()

    # Same error for wrong email and wrong password: no account enumeration
    if not user or not user.is_active or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = datetime.utcnow()
    db.add(user)
    db.commit()

    # The token is returned as well as set as a cookie: browsers that block
    # cross-site cookies (e.g. Safari with the API on another domain) fall
    # back to sending it as a Bearer header from localStorage.
    token = create_user_session(db, user)
    _set_session_cookie(response, SESSION_COOKIE_NAME, token, SESSION_MAX_AGE)
    return {
        "authenticated": True,
        "token": token,
        "user": _user_payload(user),
        "organisation": _org_payload(org),
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """End the session: delete the server-side session row and both cookies."""
    for token in get_token_candidates(request):
        db.query(UserSession).filter(
            UserSession.token_hash == hash_token(token)
        ).delete()
    db.commit()
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"authenticated": False}


@router.get("/me")
async def me(
    org: Organisation = Depends(get_current_organisation),
    principal: Optional[Principal] = Depends(get_current_principal),
) -> dict[str, Any]:
    """Current identity: user, role and organisation."""
    if principal is None:
        return {"authenticated": False, "user": None, "role": None, "organisation": _org_payload(org)}
    return {
        "authenticated": True,
        "user": _user_payload(principal.user),
        "role": principal.role.value,
        "organisation": _org_payload(org),
    }


@router.get("/status")
async def auth_status(
    org: Organisation = Depends(get_current_organisation),
    principal: Optional[Principal] = Depends(get_current_principal),
) -> dict[str, Any]:
    """Lightweight auth check (predates /me; kept for older clients)."""
    return {
        "authenticated": principal is not None,
        "organisation": _org_payload(org),
    }


# ============================================================================
# Own profile
# ============================================================================

@router.patch("/me")
async def update_profile(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_user),
) -> dict[str, Any]:
    """Update own name (any role)."""
    user = db.get(User, principal.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.first_name is not None:
        if not body.first_name.strip():
            raise HTTPException(status_code=422, detail="First name cannot be empty")
        user.first_name = body.first_name.strip()
    if body.last_name is not None:
        user.last_name = body.last_name.strip() or None
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_payload(user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_user),
) -> dict[str, Any]:
    """Change own password; revokes all existing sessions and issues a new one."""
    user = db.get(User, principal.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    validate_new_password(body.new_password)

    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    revoke_user_sessions(db, user.id)

    token = create_user_session(db, user)
    _set_session_cookie(response, SESSION_COOKIE_NAME, token, SESSION_MAX_AGE)
    return {"authenticated": True, "token": token}


# ============================================================================
# Password reset
# ============================================================================

@router.post("/request-password-reset")
async def request_password_reset(
    body: RequestPasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
) -> dict[str, str]:
    """Send a reset link if the account exists. Always returns 200."""
    email = body.email.lower()
    enforce_rate_limit(reset_rate_limiter, f"reset:{_client_ip(request)}:{email}")

    user = db.query(User).filter(
        User.organisation_id == org.id,
        func.lower(User.email) == email,
        User.is_active == True,  # noqa: E712
    ).first()

    if user:
        token = generate_token()
        user.password_reset_token_hash = hash_token(token)
        user.password_reset_expires_at = datetime.utcnow() + PASSWORD_RESET_MAX_AGE
        db.add(user)
        db.commit()
        reset_url = f"{settings.frontend_url_for(org.slug)}/reset-password?token={token}"
        send_password_reset_email(user.email, org.name, reset_url)

    return {"detail": "If that email has an account, a reset link has been sent"}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Set a new password from an emailed reset token; logs the user in."""
    user = db.query(User).filter(
        User.password_reset_token_hash == hash_token(body.token),
        User.is_active == True,  # noqa: E712
    ).first()
    if not user or not user.password_reset_expires_at or user.password_reset_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset link; request a new one")
    validate_new_password(body.password)

    user.password_hash = hash_password(body.password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    db.add(user)
    db.commit()
    revoke_user_sessions(db, user.id)

    token = create_user_session(db, user)
    _set_session_cookie(response, SESSION_COOKIE_NAME, token, SESSION_MAX_AGE)
    return {"authenticated": True, "token": token, "user": _user_payload(user)}


# ============================================================================
# Invites
# ============================================================================

@router.get("/invites/lookup")
async def lookup_invite(
    token: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Public: validate an invite token for the accept-invite page."""
    invite = _find_open_invite(db, token)
    if not invite:
        raise HTTPException(status_code=404, detail="This invite is invalid, expired or already used")
    org = db.get(Organisation, invite.organisation_id)
    return {
        "email": invite.email,
        "role": UserRole(invite.role).value,
        "organisation": _org_payload(org) if org else None,
    }


@router.post("/accept-invite")
async def accept_invite(
    body: AcceptInviteRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create an account from an invite and log in."""
    invite = _find_open_invite(db, body.token)
    if not invite:
        raise HTTPException(status_code=404, detail="This invite is invalid, expired or already used")
    if not body.first_name.strip():
        raise HTTPException(status_code=422, detail="First name is required")
    validate_new_password(body.password)

    existing = db.query(User).filter(
        User.organisation_id == invite.organisation_id,
        func.lower(User.email) == invite.email.lower(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists; log in instead")

    user = User(
        organisation_id=invite.organisation_id,
        email=invite.email.lower(),
        first_name=body.first_name.strip(),
        last_name=(body.last_name or "").strip() or None,
        password_hash=hash_password(body.password),
        role=UserRole(invite.role),
        last_login_at=datetime.utcnow(),
    )
    invite.accepted_at = datetime.utcnow()
    db.add(user)
    db.add(invite)
    db.commit()
    db.refresh(user)

    org = db.get(Organisation, invite.organisation_id)
    token = create_user_session(db, user)
    _set_session_cookie(response, SESSION_COOKIE_NAME, token, SESSION_MAX_AGE)
    return {
        "authenticated": True,
        "token": token,
        "user": _user_payload(user),
        "organisation": _org_payload(org) if org else None,
    }


@router.get("/invites", response_model=List[InviteRead])
async def list_invites(
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> Any:
    """Admin: open (unaccepted) invites, newest first."""
    return db.query(Invite).filter(
        Invite.organisation_id == org.id,
        Invite.accepted_at == None,  # noqa: E711
    ).order_by(col(Invite.created_at).desc()).all()


@router.post("/invites", status_code=201)
async def create_invite(
    body: InviteCreate,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> dict[str, Any]:
    """Admin: invite an email address with a role.

    The invite link is emailed and also returned, so it can be copied and
    shared manually (e.g. before email sending is configured).
    """
    email = body.email.lower()

    if db.query(User).filter(
        User.organisation_id == org.id,
        func.lower(User.email) == email,
    ).first():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    # Replace any open invite for the same email rather than stacking them
    db.query(Invite).filter(
        Invite.organisation_id == org.id,
        func.lower(Invite.email) == email,
        Invite.accepted_at == None,  # noqa: E711
    ).delete(synchronize_session=False)

    token = generate_token()
    invite = Invite(
        organisation_id=org.id,
        email=email,
        role=body.role,
        token_hash=hash_token(token),
        invited_by_user_id=principal.user_id,
        expires_at=datetime.utcnow() + INVITE_MAX_AGE,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    invite_url = _invite_url(org, token)
    email_sent = send_invite_email(email, org.name, invite_url, body.role.value)

    return {
        "invite": InviteRead.model_validate(invite, from_attributes=True).model_dump(mode="json"),
        "invite_url": invite_url,
        "email_sent": email_sent,
    }


@router.post("/invites/{invite_id}/resend")
async def resend_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> dict[str, Any]:
    """Admin: regenerate an invite's token/expiry and resend the email."""
    invite = db.query(Invite).filter(
        Invite.id == invite_id,
        Invite.organisation_id == org.id,
    ).first()
    if not invite or invite.accepted_at is not None:
        raise HTTPException(status_code=404, detail="Invite not found")

    token = generate_token()
    invite.token_hash = hash_token(token)
    invite.expires_at = datetime.utcnow() + INVITE_MAX_AGE
    db.add(invite)
    db.commit()

    invite_url = _invite_url(org, token)
    email_sent = send_invite_email(invite.email, org.name, invite_url, UserRole(invite.role).value)
    return {"invite_url": invite_url, "email_sent": email_sent}


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> None:
    """Admin: revoke an open invite."""
    invite = db.query(Invite).filter(
        Invite.id == invite_id,
        Invite.organisation_id == org.id,
        Invite.accepted_at == None,  # noqa: E711
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()


# ============================================================================
# User management (admin)
# ============================================================================

@router.get("/users", response_model=List[UserRead])
async def list_users(
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> Any:
    """Admin: all users in the organisation."""
    return db.query(User).filter(
        User.organisation_id == org.id,
    ).order_by(User.created_at).all()


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    body: UserAdminUpdate,
    db: Session = Depends(get_db),
    org: Organisation = Depends(get_current_organisation),
    principal: Principal = Depends(require_admin_role),
) -> Any:
    """Admin: change a user's role or active state.

    Admins cannot demote or deactivate themselves — this guarantees every
    org always keeps at least one working admin account.
    """
    user = db.query(User).filter(
        User.id == user_id,
        User.organisation_id == org.id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == principal.user_id:
        if body.role is not None and body.role != UserRole.admin:
            raise HTTPException(status_code=400, detail="You cannot change your own role")
        if body.is_active is False:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
        if body.is_active is False:
            revoke_user_sessions(db, user.id)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user
