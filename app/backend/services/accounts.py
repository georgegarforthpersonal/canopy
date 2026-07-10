"""Account ↔ surveyor linking.

Every user account gets exactly one surveyor row (uq_surveyor_user_id).
It is created at registration, or claimed from an existing historical row
when the invite named one.
"""
from typing import Optional

from sqlalchemy.orm import Session

from models import Surveyor, User


def ensure_linked_surveyor(
    db: Session,
    user: User,
    organisation_id: int,
    claim: Optional[Surveyor] = None,
) -> Surveyor:
    """Return the surveyor linked to ``user``, creating or claiming one.

    ``claim`` is the historical surveyor row the invite pointed at; it is
    claimed only if it is still unclaimed and in the same organisation —
    otherwise a fresh row is created rather than failing registration, since
    a duplicate surveyor is visible and merged deliberately by an admin.
    Deliberately NO name-matching: a wrong guess mis-attributes someone
    else's survey history.

    Flushes but does not commit; the caller owns the transaction.
    """
    db.flush()  # populate user.id for freshly-added users

    surveyor = db.query(Surveyor).filter(Surveyor.user_id == user.id).first()
    if surveyor:
        return surveyor  # type: ignore[no-any-return]

    if claim is not None and claim.user_id is None and claim.organisation_id == organisation_id:
        claim.user_id = user.id
        claim.is_active = True  # they just registered; they're active
        db.add(claim)
        db.flush()
        return claim

    surveyor = Surveyor(
        first_name=user.first_name,
        last_name=user.last_name,
        organisation_id=organisation_id,
        user_id=user.id,
    )
    db.add(surveyor)
    db.flush()
    return surveyor
