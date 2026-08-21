"""Unit tests for JSON envelope reconstruction in `_native.py`."""

from __future__ import annotations

import json
import unittest

from solvapay._native import reconstruct_envelope_error, unwrap_envelope
from solvapay.errors import PaywallError, SolvaPayError


class NativeEnvelopeTests(unittest.TestCase):
    def test_unwrap_envelope_ok(self) -> None:
        payload = {"ok": True, "value": {"customer_ref": "cus_x"}}
        self.assertEqual(
            unwrap_envelope(json.dumps(payload)),
            {"customer_ref": "cus_x"},
        )

    def test_unwrap_envelope_invalid_json(self) -> None:
        with self.assertRaises(SolvaPayError) as ctx:
            unwrap_envelope("not-json")
        self.assertIn("invalid JSON envelope", str(ctx.exception))

    def test_unwrap_envelope_malformed(self) -> None:
        with self.assertRaises(SolvaPayError) as ctx:
            unwrap_envelope(json.dumps({"unexpected": True}))
        self.assertIn("malformed envelope", str(ctx.exception))

    def test_reconstruct_api_error(self) -> None:
        err = reconstruct_envelope_error(
            {
                "kind": "Api",
                "message": "bad request",
                "status": 400,
                "code": "invalid_request",
            },
        )
        self.assertIsInstance(err, SolvaPayError)
        self.assertEqual(str(err), "bad request")
        self.assertEqual(err.status, 400)
        self.assertEqual(err.code, "invalid_request")

    def test_reconstruct_paywall_error(self) -> None:
        gate = {"kind": "gate", "message": "upgrade"}
        err = reconstruct_envelope_error(
            {"kind": "Paywall", "message": "blocked", "gate": gate},
        )
        self.assertIsInstance(err, PaywallError)
        self.assertEqual(err.structured_content, gate)

    def test_reconstruct_transport_error(self) -> None:
        err = reconstruct_envelope_error(
            {"kind": "Transport", "message": "offline", "retryable": True},
        )
        self.assertIsInstance(err, SolvaPayError)
        self.assertEqual(str(err), "offline")

    def test_unwrap_envelope_propagates_reconstructed_api(self) -> None:
        envelope = {
            "ok": False,
            "error": {
                "kind": "Api",
                "message": "nope",
                "status": 502,
                "code": "upstream_error",
            },
        }
        with self.assertRaises(SolvaPayError) as ctx:
            unwrap_envelope(json.dumps(envelope))
        self.assertEqual(ctx.exception.status, 502)
        self.assertEqual(ctx.exception.code, "upstream_error")


if __name__ == "__main__":
    unittest.main()
