"""
Authentication and authorization.

Two kinds of credential are accepted during the accounts transition:

1. User sessions (the real system): per-user accounts with argon2id password
   hashes and three ordered roles (viewer < editor < admin). Sessions are
   server-side rows in ``user_session`` holding a sha256 of the token, so
   deactivating a user or changing their role takes effect immediately.

2. Legacy organisation sessions: the old shared-admin-password flow. A valid
   legacy token is treated as an *admin* principal for its organisation. This
   path exists only so nobody is locked out while accounts are rolled out;
   it is removed at cutover along with ``organisation.admin_password``.

Request handlers depend on :func:`require_role` (or the ``require_user``
alias) and receive a :class:`Principal`.
"""

import hashlib
import hmac
import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Deque, Dict, Optional, Tuple

import sentry_sdk
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from fastapi import Depends, Request, HTTPException, status
from sqlalchemy.orm import Session

from config import settings
from models import Organisation, User, UserRole, UserSession

logger = logging.getLogger(__name__)

# Legacy org-password session cookie (kept until cutover)
SESSION_COOKIE_NAME = "admin_session"
SESSION_MAX_AGE = 60 * 60 * 24  # 24 hours

# User account sessions: 30-day sliding expiry suits multi-day fieldwork
USER_SESSION_COOKIE_NAME = "canopy_session"
USER_SESSION_MAX_AGE = 60 * 60 * 24 * 30
# Extend the sliding window at most this often, to avoid a DB write per request
USER_SESSION_REFRESH_INTERVAL = 60 * 60

MIN_PASSWORD_LENGTH = 10
# Tokens are emailed/displayed once; only their sha256 is stored
INVITE_MAX_AGE = timedelta(days=7)
PASSWORD_RESET_MAX_AGE = timedelta(hours=1)

_ROLE_RANK: Dict[UserRole, int] = {
    UserRole.viewer: 0,
    UserRole.editor: 1,
    UserRole.admin: 2,
}

_password_hasher = PasswordHasher()

# A handful of passwords so common they are guessed before any rate limit bites
_DENYLISTED_PASSWORDS = {
    "password12", "password123", "1234567890", "qwertyuiop",
    "administrator", "letmein123", "welcome123", "changeme123",
}


# ============================================================================
# Password hashing and token helpers
# ============================================================================

def hash_password(password: str) -> str:
    """Hash a password with argon2id."""
    return str(_password_hasher.hash(password))


def verify_password(password_hash: str, password: str) -> bool:
    """Verify a password against an argon2id hash (constant-time)."""
    try:
        return bool(_password_hasher.verify(password_hash, password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True if the hash was made with outdated parameters."""
    return bool(_password_hasher.check_needs_rehash(password_hash))


def validate_new_password(password: str) -> None:
    """Raise HTTPException(422) if a chosen password is unacceptable."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if len(password) > 200:
        raise HTTPException(status_code=422, detail="Password is too long")
    if password.lower() in _DENYLISTED_PASSWORDS:
        raise HTTPException(status_code=422, detail="That password is too common")


def generate_token() -> str:
    """Random URL-safe token for sessions, invites and password resets."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """sha256 hex digest — what we store instead of the raw token."""
    return hashlib.sha256(token.encode()).hexdigest()


# ============================================================================
# Principal — the authenticated caller
# ============================================================================

@dataclass
class Principal:
    """The authenticated caller, however they authenticated.

    ``user`` is None (and ``is_legacy`` True) for legacy org-password
    sessions, which act as admin for their organisation. ``organisation_id``
    is None for legacy principals — their org is resolved from the token's
    embedded slug by ``get_current_organisation``.
    """
    role: UserRole
    user: Optional[User] = None
    organisation_id: Optional[int] = None
    legacy_org_slug: Optional[str] = None

    @property
    def is_legacy(self) -> bool:
        return self.user is None

    @property
    def user_id(self) -> Optional[int]:
        return self.user.id if self.user else None

    def has_role(self, minimum: UserRole) -> bool:
        return _ROLE_RANK[self.role] >= _ROLE_RANK[minimum]


# ============================================================================
# User sessions (DB-backed)
# ============================================================================

def create_user_session(db: Session, user: User) -> str:
    """Create a session row for a user and return the raw token."""
    token = generate_token()
    now = datetime.utcnow()
    db.add(UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=now + timedelta(seconds=USER_SESSION_MAX_AGE),
        last_seen_at=now,
    ))
    db.commit()
    return token


def revoke_user_sessions(db: Session, user_id: int) -> None:
    """Delete all sessions for a user (deactivation, password change)."""
    db.query(UserSession).filter(UserSession.user_id == user_id).delete()
    db.commit()


def _resolve_user_session(db: Session, token: str) -> Optional[Principal]:
    """Return a Principal for a valid user-session token, else None.

    Extends the sliding expiry at most hourly so routine traffic doesn't
    write on every request.
    """
    now = datetime.utcnow()
    session = db.query(UserSession).filter(
        UserSession.token_hash == hash_token(token),
        UserSession.expires_at > now,
    ).first()
    if not session:
        return None

    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        return None

    if (now - session.last_seen_at).total_seconds() > USER_SESSION_REFRESH_INTERVAL:
        session.last_seen_at = now
        session.expires_at = now + timedelta(seconds=USER_SESSION_MAX_AGE)
        db.add(session)
        db.commit()

    return Principal(
        role=UserRole(user.role),
        user=user,
        organisation_id=user.organisation_id,
    )


# ============================================================================
# Legacy organisation-password sessions (removed at cutover)
# ============================================================================

def verify_org_password(password: str, org: Organisation) -> bool:
    """Verify a password against an organisation's legacy shared password."""
    return hmac.compare_digest(password.encode(), (org.admin_password or "").encode())


def create_session_token(org_slug: str) -> str:
    """Create a signed legacy token: {org_slug}.{timestamp}.{signature}."""
    timestamp = str(int(time.time()))
    secret = settings.session_secret_key
    payload = f"{org_slug}.{timestamp}"
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{org_slug}.{timestamp}.{signature}"


def validate_session_token(token: str) -> Tuple[bool, Optional[str]]:
    """Validate a legacy token; returns (is_valid, org_slug)."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return False, None

        org_slug, timestamp, signature = parts
        secret = settings.session_secret_key
        payload = f"{org_slug}.{timestamp}"
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(signature, expected):
            return False, None

        if (time.time() - int(timestamp)) >= SESSION_MAX_AGE:
            return False, None

        return True, org_slug
    except (ValueError, TypeError):
        return False, None


# ============================================================================
# Request → Principal resolution
# ============================================================================

def get_token_candidates(request: Request) -> list[str]:
    """Possible auth tokens on a request, most specific first."""
    candidates = []
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        candidates.append(auth_header[7:])
    for cookie_name in (USER_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME):
        cookie = request.cookies.get(cookie_name)
        if cookie:
            candidates.append(cookie)
    return candidates


def get_token_from_request(request: Request) -> Optional[str]:
    """First auth token on the request (header, then cookies), if any."""
    candidates = get_token_candidates(request)
    return candidates[0] if candidates else None


def resolve_principal(request: Request, db: Session) -> Optional[Principal]:
    """Resolve the caller from session cookies / Authorization header.

    Tries each candidate token first as a user session, then as a legacy
    org token. Returns None for anonymous requests.
    """
    for token in get_token_candidates(request):
        principal = _resolve_user_session(db, token)
        if principal:
            return principal

        is_valid, org_slug = validate_session_token(token)
        if is_valid:
            return Principal(role=UserRole.admin, legacy_org_slug=org_slug)

    return None


def get_current_principal(request: Request) -> Optional[Principal]:
    """FastAPI dependency: the authenticated caller, or None.

    Memoised on request.state so auth and org resolution share one lookup.
    Opens and closes its own short-lived DB session (see
    ``get_current_organisation`` for why request-scoped sessions are avoided).
    Overridden in tests to run the same logic against the test transaction.
    """
    if getattr(request.state, "principal_resolved", False):
        return getattr(request.state, "principal", None)

    from database.connection import get_session_factory

    SessionLocal = get_session_factory()
    with SessionLocal() as db:
        principal = resolve_principal(request, db)

    request.state.principal = principal
    request.state.principal_resolved = True
    _set_sentry_user(principal)
    return principal


def _set_sentry_user(principal: Optional[Principal]) -> None:
    """Attach the caller to Sentry events for attribution."""
    if principal is None:
        sentry_sdk.set_user(None)
    elif principal.is_legacy:
        sentry_sdk.set_user({"id": "legacy-admin", "username": f"legacy:{principal.legacy_org_slug}"})
    else:
        sentry_sdk.set_user({"id": str(principal.user_id), "email": principal.user.email if principal.user else None})


# ============================================================================
# Authorization dependencies
# ============================================================================

def require_role(minimum: UserRole):  # type: ignore[no-untyped-def]
    """Dependency factory: 401 if anonymous, 403 if below ``minimum``.

    Resolves the principal via Depends so tests can override
    ``get_current_principal`` to run against the test transaction.
    """

    def check(principal: Optional[Principal] = Depends(get_current_principal)) -> Principal:
        if principal is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        if not principal.has_role(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {minimum.value} access",
            )
        return principal

    return check


# Any logged-in account (viewer and up); use for read endpoints
require_user = require_role(UserRole.viewer)
# Create/edit surveys and media
require_editor = require_role(UserRole.editor)
# Admin page, user management
require_admin_role = require_role(UserRole.admin)


# ============================================================================
# Login rate limiting
# ============================================================================

class RateLimiter:
    """Small in-memory sliding-window limiter.

    Per-process only — fine for a single-instance deployment, and argon2
    verification is deliberately slow anyway. Keyed by (scope, key).
    """

    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: Dict[str, Deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        window = self._attempts.setdefault(key, deque())
        while window and now - window[0] > self.window_seconds:
            window.popleft()
        if len(window) >= self.max_attempts:
            return False
        window.append(now)
        return True

    def reset(self) -> None:
        self._attempts.clear()


# 10 attempts per 5 minutes per (ip, email); generous for humans, slow for bots
login_rate_limiter = RateLimiter(max_attempts=10, window_seconds=300)
# Password reset emails: 3 per 15 minutes per email
reset_rate_limiter = RateLimiter(max_attempts=3, window_seconds=900)


def enforce_rate_limit(limiter: RateLimiter, key: str) -> None:
    """Raise 429 when a limiter rejects the key."""
    if not limiter.allow(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts; try again in a few minutes",
        )
