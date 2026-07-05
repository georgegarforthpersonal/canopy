"""
Transactional email via Resend (invites, password resets).

When RESEND_API_KEY is not configured (local dev, tests), emails are logged
instead of sent so flows remain testable end-to-end — the invite/reset URL is
also returned to the caller where appropriate, so an admin can always copy
the link out of the UI and share it manually.
"""

import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, html: str) -> bool:
    """Send one email. Returns True if handed to the provider.

    Never raises: callers treat delivery as best-effort (the invite/reset
    link is still retrievable by an admin), so a provider outage must not
    fail the request.
    """
    if not settings.resend_api_key:
        logger.info("Email sending not configured; would send to %s: %s", to, subject)
        return False

    try:
        response = httpx.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "html": html,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError:
        logger.exception("Failed to send email to %s (%s)", to, subject)
        return False


def send_invite_email(to: str, org_name: str, invite_url: str, role: str, site_url: str) -> bool:
    """Invitation to create an account for an organisation."""
    subject = f"You're invited to join {org_name} on Canopy"
    html = f"""
    <p>Hello,</p>
    <p>You've been invited to join <strong>{org_name}</strong> on Canopy
    with <strong>{role}</strong> access.</p>
    <p><a href="{invite_url}">Accept your invitation</a> to choose a password
    and get started. The link is valid for 7 days.</p>
    <p>After that, sign in any time at
    <a href="{site_url}">{site_url}</a> — worth a bookmark.</p>
    <p>If you weren't expecting this, you can ignore this email.</p>
    """
    return send_email(to, subject, html)


def send_password_reset_email(to: str, org_name: str, reset_url: str) -> bool:
    """Password reset link."""
    subject = f"Reset your Canopy password ({org_name})"
    html = f"""
    <p>Hello,</p>
    <p>Someone asked to reset the password for this email address at
    <strong>{org_name}</strong> on Canopy.</p>
    <p><a href="{reset_url}">Choose a new password</a>. The link is valid
    for 1 hour.</p>
    <p>If this wasn't you, you can ignore this email — your password is
    unchanged.</p>
    """
    return send_email(to, subject, html)
