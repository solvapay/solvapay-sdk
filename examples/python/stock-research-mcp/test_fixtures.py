from __future__ import annotations

import json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def test_recorded_fixtures_preserve_live_quirks() -> None:
    feed = json.loads((FIXTURES / "public.json").read_text())
    last_updated = str(feed["last_updated"])
    assert last_updated.startswith("2026-08-18")

    trgp = json.loads((FIXTURES / "company_TRGP.json").read_text())
    newer = [
        row["filingDate"]
        for row in trgp["filings"]["recent"]
        if row["filingDate"] > last_updated[:10]
    ]
    assert newer, "TRGP fixture must include filings newer than the ranking feed"

    ge_history = json.loads((FIXTURES / "company_GE.json").read_text())["earnings"]["history"]
    trgp_history = trgp["earnings"]["history"]
    assert sum(1 for row in ge_history if row["result"] == "beat") == 4
    assert sum(1 for row in trgp_history if row["result"] == "beat") == 3

    amgn_text = json.loads((FIXTURES / "company_AMGN.json").read_text())["summary"]["text"]
    assert len(amgn_text) == 209

    missing = json.loads((FIXTURES / "company_BOGUSXYZ.json").read_text())
    assert missing["error"] == "No company found for ticker 'BOGUSXYZ'."
