from __future__ import annotations

import json
from pathlib import Path

from analysis import classify_summary, corroborate_catalyst, filings_since

FIXTURES = Path(__file__).parent / "fixtures"


def _company(symbol: str) -> dict[str, object]:
    return json.loads((FIXTURES / f"company_{symbol}.json").read_text())


def _feed() -> dict[str, object]:
    return json.loads((FIXTURES / "public.json").read_text())


def _row(symbol: str) -> dict[str, object]:
    data = _feed()["data"]
    assert isinstance(data, dict)
    for item in data["stocks"]:
        assert isinstance(item, dict)
        if item["symbol"] == symbol:
            return item
    raise AssertionError(f"missing ranked row {symbol}")


def test_corroborated_when_growth_claim_has_four_beats() -> None:
    result = corroborate_catalyst(_row("GE"), _company("GE")["earnings"])
    assert result["verdict"] == "corroborated"
    assert result["beats"] == 4
    assert result["quarters"] == 4
    assert result["claim"] == _row("GE")["catalyst_summary"]
    assert isinstance(result["mean_surprise_percent"], float)


def test_partially_corroborated_when_growth_claim_has_three_beats() -> None:
    result = corroborate_catalyst(_row("TRGP"), _company("TRGP")["earnings"])
    assert result["verdict"] == "partially_corroborated"
    assert result["beats"] == 3
    assert result["quarters"] == 4


def test_contradicted_when_growth_claim_has_no_beats() -> None:
    earnings = {
        "status": "ok",
        "history": [
            {"result": "miss", "surprisePercent": -10.0},
            {"result": "miss", "surprisePercent": -2.0},
            {"result": "miss", "surprisePercent": -1.0},
            {"result": "miss", "surprisePercent": -4.0},
        ],
    }
    row = {
        "symbol": "FAKE",
        "catalyst_summary": "Strong earnings growth; High institutional ownership",
    }
    result = corroborate_catalyst(row, earnings)
    assert result["verdict"] == "contradicted"
    assert result["beats"] == 0
    assert result["quarters"] == 4
    assert result["mean_surprise_percent"] == -4.25


def test_not_judged_when_claim_has_no_earnings_component() -> None:
    result = corroborate_catalyst(
        {
            "symbol": "GE",
            "catalyst_summary": "Strong buy consensus; High institutional ownership",
        },
        _company("GE")["earnings"],
    )
    assert result["verdict"] == "not_judged"
    assert result["beats"] == 4


def test_filings_newer_than_feed_last_updated_are_flagged() -> None:
    last_updated = str(_feed()["last_updated"])
    flagged = filings_since(last_updated, _company("TRGP")["filings"]["recent"])
    dates = [row["filingDate"] for row in flagged]
    assert "2026-08-25" in dates
    assert all(date > last_updated[:10] for date in dates)


def test_same_day_filings_are_not_flagged() -> None:
    flagged = filings_since(
        "2026-08-25T09:00:00",
        [{"form": "8-K", "filingDate": "2026-08-25", "url": "https://example"}],
    )
    assert flagged == []


def test_empty_recent_filings_are_handled() -> None:
    assert filings_since("2026-08-18T13:41:39", []) == []


def test_classify_summary_marks_glossary_note_thin() -> None:
    text = str(_company("AMGN")["summary"]["text"])
    assert len(text) == 209
    assert classify_summary(text) == "thin"


def test_classify_summary_marks_business_description_substantive() -> None:
    text = str(_company("AAPL")["summary"]["text"])
    assert classify_summary(text) == "substantive"
