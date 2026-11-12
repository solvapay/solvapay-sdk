"""Webhook signature verification, matching ``@solvapay/server``'s ``verifyWebhook``.

SolvaPay signs a delivery as HMAC-SHA256 over ``"{t}.{raw body}"``, keyed by
the whole signing secret (``whsec_…``, UTF-8), and sends it in the
``SV-Signature`` header as ``t={unix seconds},v1={lowercase hex}``.

```python
from solvapay import verify_webhook

event = verify_webhook(
    body=request.body,                       # the raw bytes or text, as received
    signature=request.headers["sv-signature"],
    secret=os.environ["SOLVAPAY_WEBHOOK_SECRET"],
)
```
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from datetime import datetime
from typing import Any, Final

from .errors import SolvaPayError

WEBHOOK_TOLERANCE_SECONDS: Final = 300

WEBHOOK_ERROR_CODES: Final = {
    "missing": "webhook_signature_missing",
    "malformed": "webhook_signature_malformed",
    "timestamp": "webhook_timestamp_out_of_tolerance",
    "invalid": "webhook_signature_invalid",
    "payload": "webhook_payload_invalid",
}


def _reject_constant(name: str) -> Any:
    # JSON has no NaN or Infinity; json.loads accepts them, JSON.parse does not.
    raise ValueError(f"{name} is not valid JSON")


def verify_webhook(
    *,
    body: str | bytes,
    signature: str | None,
    secret: str,
    now: datetime | None = None,
) -> Any:
    """Verifies a delivery and returns the parsed event.

    Raises ``SolvaPayError`` whose ``code`` is one of ``WEBHOOK_ERROR_CODES``.
    ``now`` is the time to check the signature's timestamp against
    (default: the current time); a timestamp more than 300 seconds away,
    either way, is rejected.
    """
    raw = body if isinstance(body, bytes) else body.encode("utf-8")
    if not signature:
        raise SolvaPayError("Missing webhook signature", code=WEBHOOK_ERROR_CODES["missing"])

    parts = [part.strip() for part in signature.split(",")]
    t_part = next((p for p in parts if p.startswith("t=")), None)
    v1_part = next((p for p in parts if p.startswith("v1=")), None)
    if t_part is None or v1_part is None:
        raise SolvaPayError("Malformed webhook signature", code=WEBHOOK_ERROR_CODES["malformed"])
    raw_timestamp, received = t_part[2:], v1_part[3:]
    if not re.fullmatch(r"\d+", raw_timestamp, flags=re.ASCII) or not received:
        raise SolvaPayError("Malformed webhook signature", code=WEBHOOK_ERROR_CODES["malformed"])

    now_seconds = int(now.timestamp()) if now is not None else int(time.time())
    if abs(now_seconds - int(raw_timestamp)) > WEBHOOK_TOLERANCE_SECONDS:
        raise SolvaPayError(
            "Webhook signature timestamp is more than "
            f"{WEBHOOK_TOLERANCE_SECONDS} seconds from now",
            code=WEBHOOK_ERROR_CODES["timestamp"],
        )

    expected = hmac.new(
        secret.encode("utf-8"), raw_timestamp.encode("ascii") + b"." + raw, hashlib.sha256
    ).hexdigest()
    # compare_digest takes ASCII text only; anything else cannot be a hex digest.
    if not received.isascii() or not hmac.compare_digest(expected, received):
        raise SolvaPayError("Invalid webhook signature", code=WEBHOOK_ERROR_CODES["invalid"])

    try:
        return json.loads(raw, parse_constant=_reject_constant)
    except ValueError as error:
        raise SolvaPayError(
            "Invalid webhook payload: body is not valid JSON", code=WEBHOOK_ERROR_CODES["payload"]
        ) from error
