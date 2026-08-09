"""UPI "scan to pay" QR generation for on-site repair payment.

The QR encodes a standard NPCI `upi://pay` deep link, which every UPI app (GPay,
PhonePe, Paytm, BHIM) understands. The image is rendered on demand and never
stored: the amount and the reference are per-job, and a stored QR would outlive
the job it belongs to.

## Which VPA the money lands in

Two modes, and the choice is a business decision rather than a technical one:

  * **Platform-collect (default).** The QR points at the platform VPA with the
    service-request reference in the transaction note. We receive the gross,
    deduct commission, and settle the mechanic's share out of band. This is the
    only mode where commission collection is actually enforceable, which is why
    it is the default.
  * **Direct-to-mechanic.** The QR points at the mechanic's own VPA. The customer
    pays the mechanic directly and the platform never touches the money — which
    also means the platform cannot deduct its commission and must invoice for it
    afterwards.

Note that collecting customer money into a platform account and settling it onward
makes GAADIIQ a payment intermediary. RBI's payment aggregator rules apply; the
practical route is to settle through Razorpay Route (or an equivalent split-
settlement product) rather than a plain current account. That integration is not
in this module — `build_upi_uri` only produces the link.
"""

from __future__ import annotations

import base64
import io
from urllib.parse import quote

from core.config import settings


def format_rupees(paise: int) -> str:
    """Paise to the two-decimal rupee string UPI expects ("2400.00")."""
    return f"{paise / 100:.2f}"


def build_upi_uri(
    payee_vpa: str,
    amount_paise: int,
    reference: str,
    payee_name: str | None = None,
    note: str | None = None,
) -> str:
    """Build an NPCI-compliant `upi://pay` deep link.

    `am` is fixed and `tn` carries the service-request reference, so the payment
    can be reconciled back to a job from the bank statement alone.
    """
    if not payee_vpa:
        raise ValueError("payee_vpa is required to build a UPI link")
    if amount_paise <= 0:
        raise ValueError("amount_paise must be positive")

    params = [
        f"pa={quote(payee_vpa)}",
        f"pn={quote(payee_name or settings.upi_payee_name)}",
        f"am={format_rupees(amount_paise)}",
        "cu=INR",
        f"tn={quote(note or f'GAADIIQ {reference}')}",
        # Transaction reference — what the PSP echoes back on settlement.
        f"tr={quote(reference)}",
    ]
    return "upi://pay?" + "&".join(params)


def build_qr_png_data_uri(payload: str) -> str | None:
    """Render `payload` as a PNG data URI, or None if qrcode is not installed.

    Returning None rather than raising is deliberate: the UPI link itself is the
    payment instrument and works as a tappable button on mobile. The QR is the
    convenience layer for a customer paying from another device, and losing it
    should degrade the page, not break the payment flow.
    """
    try:
        import qrcode  # type: ignore[import-untyped]
    except ImportError:
        return None

    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
