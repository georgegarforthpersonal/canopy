#!/usr/bin/env python3
"""
Backfill linked surveyors for users who registered before surveyor
creation moved into accept-invite.

For each user with no linked surveyor, the script suggests unclaimed
surveyor rows whose name matches and asks the runner to confirm — the
match is always a human decision, never automatic. Confirming links the
historical row (claiming its survey history); declining, or having no
candidates, creates a fresh surveyor named after the account. Nothing is
written until every user has been decided and the batch is confirmed.

Usage:
    ./run staging backfill_user_surveyors.py
    ./run prod backfill_user_surveyors.py
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import Organisation, Surveyor, User
from services.accounts import ensure_linked_surveyor

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def _name(first: str, last: str | None) -> str:
    return f"{first} {last}" if last else first


def _surveyor_label(s: Surveyor) -> str:
    active = "" if s.is_active else ", inactive"
    return f"{_name(s.first_name, s.last_name)} (surveyor id={s.id}{active})"


def _candidates(unclaimed: list[Surveyor], user: User) -> list[Surveyor]:
    """Unclaimed surveyors ranked: exact full-name matches, then same first
    or last name. Case-insensitive; only used as suggestions."""
    first = user.first_name.strip().lower()
    last = (user.last_name or "").strip().lower()
    exact, partial = [], []
    for s in unclaimed:
        s_first = s.first_name.strip().lower()
        s_last = (s.last_name or "").strip().lower()
        if s_first == first and s_last == last:
            exact.append(s)
        elif s_first == first or (last and s_last == last):
            partial.append(s)
    return exact + partial


def _choose(user: User, candidates: list[Surveyor]) -> Surveyor | None:
    """Ask the runner which surveyor this user is; None means create fresh."""
    print(f"\nUser: {_name(user.first_name, user.last_name)} <{user.email}> (user id={user.id})")
    if not candidates:
        print("  No matching unclaimed surveyors — a fresh surveyor will be created.")
        return None
    for i, s in enumerate(candidates, start=1):
        print(f"  [{i}] link to {_surveyor_label(s)}")
    print("  [n] none of these — create a fresh surveyor")
    while True:
        answer = input(f"  Match? [1-{len(candidates)}/n]: ").strip().lower()
        if answer == "n":
            return None
        if answer.isdigit() and 1 <= int(answer) <= len(candidates):
            return candidates[int(answer) - 1]
        print("  Please enter a number from the list, or n.")


def backfill() -> None:
    if not sys.stdin.isatty():
        logger.error("This script is interactive and needs a TTY")
        sys.exit(1)

    with Session(get_engine()) as db:
        linked_user_ids = {
            uid for (uid,) in db.query(Surveyor.user_id).filter(Surveyor.user_id != None)  # noqa: E711
        }
        users = [
            u for u in db.query(User).order_by(User.organisation_id, User.id).all()
            if u.id not in linked_user_ids
        ]
        if not users:
            logger.info("Every user already has a linked surveyor — nothing to do.")
            return
        logger.info(f"{len(users)} user(s) without a linked surveyor.")

        org_names = {o.id: o.name for o in db.query(Organisation).all()}
        unclaimed_by_org: dict[int, list[Surveyor]] = {}
        for s in db.query(Surveyor).filter(Surveyor.user_id == None).all():  # noqa: E711
            unclaimed_by_org.setdefault(s.organisation_id, []).append(s)

        # Decide everything first, write nothing until the batch is confirmed.
        decisions: list[tuple[User, Surveyor | None]] = []
        for user in users:
            print(f"\n--- {org_names.get(user.organisation_id, f'org {user.organisation_id}')} ---")
            claim = _choose(user, _candidates(unclaimed_by_org.get(user.organisation_id, []), user))
            if claim is not None:
                # No longer offerable to later users in this run
                unclaimed_by_org[user.organisation_id].remove(claim)
            decisions.append((user, claim))

        print("\nPlanned changes:")
        for user, claim in decisions:
            action = f"claim {_surveyor_label(claim)}" if claim else "create a fresh surveyor"
            print(f"  {_name(user.first_name, user.last_name)} <{user.email}>: {action}")
        if input(f"\nApply these {len(decisions)} change(s)? [y/N]: ").strip().lower() != "y":
            logger.info("Aborted — nothing written.")
            return

        for user, claim in decisions:
            surveyor = ensure_linked_surveyor(db, user, user.organisation_id, claim=claim)
            logger.info(f"{user.email} -> {_surveyor_label(surveyor)}")
        db.commit()
        logger.info(f"Linked {len(decisions)} user(s).")


if __name__ == "__main__":
    try:
        backfill()
    except (EOFError, KeyboardInterrupt):
        print()
        logger.info("Aborted — nothing written.")
        sys.exit(1)
