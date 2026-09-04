"""Unit tests for golden-fixture outcome normalization."""

from __future__ import annotations

import unittest

from contract.compare import outcome_from_exception
from solvapay.errors import SolvaPayError


class ContractCompareTests(unittest.TestCase):
    def test_outcome_from_exception_keeps_api_kind_without_http_status(self) -> None:
        err = SolvaPayError("No product ref resolved.")
        setattr(err, "kind", "Api")
        setattr(err, "code", "missing_product_ref")
        outcome = outcome_from_exception(err)
        self.assertEqual(outcome.error_kind, "Api")
        self.assertEqual(outcome.error_code, "missing_product_ref")
        self.assertIsNone(outcome.error_status)


if __name__ == "__main__":
    unittest.main()
