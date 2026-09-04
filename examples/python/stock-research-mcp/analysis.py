from __future__ import annotations

_EARNINGS_CLAIM_MARKERS = ("earnings growth", "earnings beat", "eps growth")
_THIN_MARKERS = (
    "we use several terms",
    "provided below",
    "see management's discussion",
    "item 7",
    "md&a",
)


def corroborate_catalyst(row: dict[str, object], earnings: object) -> dict[str, object]:
    if not isinstance(earnings, dict):
        raise TypeError("earnings must be an object")
    history = earnings.get("history")
    if not isinstance(history, list):
        history = []

    beats = 0
    surprises: list[float] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        if str(item.get("result", "")).lower() == "beat":
            beats += 1
        surprise = item.get("surprisePercent")
        if isinstance(surprise, int | float):
            surprises.append(float(surprise))

    quarters = len(history)
    mean_surprise = sum(surprises) / len(surprises) if surprises else 0.0
    claim = str(row.get("catalyst_summary") or "")
    has_earnings_claim = any(marker in claim.lower() for marker in _EARNINGS_CLAIM_MARKERS)

    if not has_earnings_claim:
        verdict = "not_judged"
    elif beats == 0:
        verdict = "contradicted"
    elif quarters > 0 and beats == quarters:
        verdict = "corroborated"
    else:
        verdict = "partially_corroborated"

    return {
        "claim": claim,
        "beats": beats,
        "misses": max(0, quarters - beats),
        "quarters": quarters,
        "mean_surprise_percent": mean_surprise,
        "verdict": verdict,
        "earnings_status": earnings.get("status"),
    }


def filings_since(feed_last_updated: str, filings_recent: object) -> list[dict[str, object]]:
    cutoff = feed_last_updated[:10]
    if not isinstance(filings_recent, list):
        return []
    flagged: list[dict[str, object]] = []
    for item in filings_recent:
        if not isinstance(item, dict):
            continue
        filing_date = str(item.get("filingDate") or "")
        if filing_date > cutoff:
            flagged.append(item)
    return flagged


def classify_summary(summary_text: str) -> str:
    lowered = summary_text.lower()
    if any(marker in lowered for marker in _THIN_MARKERS):
        return "thin"
    return "substantive"
