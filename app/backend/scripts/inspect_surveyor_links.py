#!/usr/bin/env python3
"""
Read-only diagnostic: show every surveyor and user matching a name fragment,
with account links, survey counts and creation times — enough to reconstruct
where a duplicate surveyor came from.

Usage:
    ./run prod inspect_surveyor_links.py goldsmith
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database.connection import get_engine
from models import Invite, Surveyor, SurveySurveyor, User

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def inspect(fragment: str) -> None:
    pattern = f"%{fragment.lower()}%"
    with Session(get_engine()) as db:
        surveyors = db.query(Surveyor).filter(
            or_(
                func.lower(Surveyor.first_name).like(pattern),
                func.lower(func.coalesce(Surveyor.last_name, "")).like(pattern),
            )
        ).order_by(Surveyor.id).all()

        logger.info(f"=== Surveyors matching '{fragment}' ({len(surveyors)}) ===")
        for s in surveyors:
            survey_count = db.query(SurveySurveyor).filter(
                SurveySurveyor.surveyor_id == s.id
            ).count()
            user = db.get(User, s.user_id) if s.user_id else None
            linked = f"linked to user {s.user_id} <{user.email}>" if user else "unlinked"
            logger.info(
                f"  id={s.id}  '{s.first_name} {s.last_name or ''}'  org={s.organisation_id}  "
                f"active={s.is_active}  created={s.created_at}  {linked}  surveys={survey_count}"
            )

        users = db.query(User).filter(
            or_(
                func.lower(User.first_name).like(pattern),
                func.lower(func.coalesce(User.last_name, "")).like(pattern),
                func.lower(User.email).like(pattern),
            )
        ).order_by(User.id).all()

        logger.info(f"\n=== Users matching '{fragment}' ({len(users)}) ===")
        for u in users:
            linked_surveyors = db.query(Surveyor).filter(Surveyor.user_id == u.id).all()
            ids = [s.id for s in linked_surveyors] or "none"
            logger.info(
                f"  id={u.id}  '{u.first_name} {u.last_name or ''}'  <{u.email}>  "
                f"created={u.created_at}  linked surveyor(s)={ids}"
            )

        invites = db.query(Invite).filter(func.lower(Invite.email).like(pattern)).all()
        logger.info(f"\n=== Invites matching '{fragment}' ({len(invites)}) ===")
        for i in invites:
            state = "accepted" if i.accepted_at else "open"
            logger.info(
                f"  id={i.id}  <{i.email}>  {state}  created={i.created_at}  "
                f"expires={i.expires_at}  surveyor_id={i.surveyor_id}"
            )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        logger.error("Usage: inspect_surveyor_links.py <name fragment>")
        sys.exit(1)
    inspect(sys.argv[1])
