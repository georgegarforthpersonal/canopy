"""
FastAPI Dependencies for Multi-Organisation Support

Provides dependencies for extracting organisation context from requests.

Security model:
- Authenticated requests: org_slug extracted from signed session token (secure)
- Unauthenticated requests (login): org_slug from X-Org-Slug header (frontend sends this)
- Local development: X-Org-Slug header or defaults to 'heal'
"""

from fastapi import Request, HTTPException
from database.connection import get_session_factory
from models import Organisation
from auth import get_session_org_slug


async def get_current_organisation(request: Request) -> Organisation:
    """
    Extract organisation from session token or X-Org-Slug header.

    Priority:
    1. Authenticated session token (most secure - org embedded in signed token)
    2. X-Org-Slug header (for login flow before session exists)
    3. Default to 'heal' for localhost (development convenience)

    Opens and closes its own session rather than using Depends(get_db): a
    request-scoped session stays checked out for the whole request, and on
    long-running endpoints (e.g. audio wizard inference) Neon's pooler reaps
    the idle socket, so teardown fails after the handler has succeeded. The
    returned Organisation is detached — column attributes are loaded, but
    relationships must not be lazy-loaded from it.

    Args:
        request: FastAPI request object

    Returns:
        Organisation object for the current request

    Raises:
        HTTPException 404: If organisation not found or inactive
    """
    org_slug = None

    # First, try to get org from authenticated session (most secure)
    session_org_slug = get_session_org_slug(request)
    if session_org_slug:
        org_slug = session_org_slug
    else:
        # Not authenticated - use X-Org-Slug header (for login flow)
        org_slug = request.headers.get("x-org-slug")

        # Fallback for localhost development
        if not org_slug:
            host = request.headers.get("host", "").lower()
            if ":" in host:
                host = host.split(":")[0]
            if host in ("localhost", "127.0.0.1"):
                org_slug = "heal"

    if not org_slug:
        raise HTTPException(
            status_code=400,
            detail="Organisation not specified. Include X-Org-Slug header."
        )

    SessionLocal = get_session_factory()
    with SessionLocal() as db:
        org = db.query(Organisation).filter(
            Organisation.slug == org_slug,
            Organisation.is_active == True
        ).first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail=f"Organisation not found: {org_slug}"
        )

    return org  # type: ignore[no-any-return]
