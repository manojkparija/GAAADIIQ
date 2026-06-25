"""
Email service — wraps aiosmtplib.
Falls back silently when SMTP_HOST is not configured (dev/test mode).
"""
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from core.config import settings

logger = logging.getLogger(__name__)


async def send_email(to: str, subject: str, html: str, text: str | None = None) -> None:
    """Send an email. No-ops silently if SMTP is not configured."""
    if not settings.SMTP_HOST:
        logger.debug("SMTP not configured — skipping email to %s: %s", to, subject)
        return

    try:
        import aiosmtplib

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to

        if text:
            msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(html, "html"))

        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER or None,
            password=settings.SMTP_PASS or None,
            use_tls=settings.SMTP_PORT == 465,
            start_tls=settings.SMTP_PORT == 587,
        )
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to send email to %s: %s", to, exc)
