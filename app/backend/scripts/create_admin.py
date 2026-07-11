#!/usr/bin/env python3
"""
Create the first admin user for an organisation.

Run once per organisation to bootstrap the accounts system; after that,
admins invite further users from the Admin page. Passwords are prompted
for interactively (never passed as arguments, so they stay out of shell
history) and stored as argon2id hashes.

Usage:
    ./dev-run create_admin.py --org heal --email admin@example.org --first-name Jane [--last-name Doe]
"""

import argparse
import getpass
import logging
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from auth import MIN_PASSWORD_LENGTH, hash_password
from database.connection import get_engine
from models import Organisation, User, UserRole
from services.accounts import ensure_linked_surveyor

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def create_admin(org_slug: str, email: str, first_name: str, last_name: str | None) -> None:
    email = email.strip().lower()

    password = getpass.getpass(f"Password for {email}: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        logger.error(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        sys.exit(1)
    if getpass.getpass("Confirm password: ") != password:
        logger.error("Passwords do not match")
        sys.exit(1)

    with Session(get_engine()) as db:
        org = db.query(Organisation).filter(Organisation.slug == org_slug).first()
        if not org:
            logger.error(f"Organisation not found: {org_slug}")
            sys.exit(1)

        existing = db.query(User).filter(
            User.organisation_id == org.id,
            User.email == email,
        ).first()
        if existing:
            logger.error(f"A user with email {email} already exists in {org.name}")
            sys.exit(1)

        user = User(
            organisation_id=org.id,
            email=email,
            first_name=first_name,
            last_name=last_name,
            password_hash=hash_password(password),
            role=UserRole.admin,
            created_at=datetime.utcnow(),
        )
        db.add(user)
        surveyor = ensure_linked_surveyor(db, user, org.id)
        db.commit()
        logger.info(f"Created admin {email} for {org.name} (id={user.id}, surveyor id={surveyor.id})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first admin user for an organisation")
    parser.add_argument("--org", required=True, help="Organisation slug (e.g. heal)")
    parser.add_argument("--email", required=True, help="Admin's email address")
    parser.add_argument("--first-name", required=True)
    parser.add_argument("--last-name", default=None)
    args = parser.parse_args()

    create_admin(args.org, args.email, args.first_name, args.last_name)


if __name__ == "__main__":
    main()
