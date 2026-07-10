"""
FastAPI Dependencies for Multi-Organisation Support

Provides dependencies for extracting organisation context from requests.

Security model:
- Authenticated requests: organisation comes from the user's account row —
  a client cannot reach another org's data by sending a different header.
- Unauthenticated requests (login, accept-invite, password reset): the
  X-Org-Slug header identifies which org's login is being used.
- Local development: X-Org-Slug header or defaults to 'heal'.
"""

from fastapi import Request, HTTPException
from database.connection import get_session_factory
from models import Organisation
from auth import get_current_principal


async def get_current_organisation(request: Request) -> Organisation:
    """
    Extract organisation from the authenticated principal or X-Org-Slug header.

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
    org_id = None
    org_slug = None

    principal = get_current_principal(request)
    if principal is not None:
        org_id = principal.organisation_id
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

    if not org_id and not org_slug:
        raise HTTPException(
            status_code=400,
            detail="Organisation not specified. Include X-Org-Slug header."
        )

    SessionLocal = get_session_factory()
    with SessionLocal() as db:
        query = db.query(Organisation).filter(Organisation.is_active == True)
        if org_id:
            org = query.filter(Organisation.id == org_id).first()
        else:
            org = query.filter(Organisation.slug == org_slug).first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail=f"Organisation not found: {org_slug or org_id}"
        )

    return org  # type: ignore[no-any-return]
