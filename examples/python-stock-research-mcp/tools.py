"""The six paid research tools, registered on a SolvaPay MCP server.

Each handler takes typed arguments (the tool's input schema comes from them)
and a ``ResponseContext``, and answers with ``ctx.respond(...)``. Every call
is checked against the customer's plan before the handler runs, and billed as
one unit when it succeeds.
"""

from __future__ import annotations

import asyncio
from typing import Any

from solvapay.mcp import ResponseContext, SolvaPayMcpServer
from solvapay.mcp.response import ResponseResult

from analysis import classify_summary, corroborate_catalyst, filings_since
from market_data import CompanyNotFoundError, MarketDataSource

DISCLAIMER = " Educational research only, not financial advice."


def register_tools(mcp: SolvaPayMcpServer, *, source: MarketDataSource, **options: Any) -> None:
    """Registers the research tools. ``options`` go to every ``register_payable`` call."""

    async def top_ranked_assets(ctx: ResponseContext) -> ResponseResult:
        return ctx.respond(await source.top_ranked())

    async def company_brief(symbol: str, ctx: ResponseContext) -> ResponseResult:
        company = await source.company(_symbol(symbol))
        return ctx.respond(brief_from_company(company))

    async def research_top_assets(ctx: ResponseContext) -> ResponseResult:
        feed = await source.top_ranked()
        companies = await asyncio.gather(*[source.company(str(r["symbol"])) for r in _rows(feed)])
        stocks = [
            {**row, "brief": brief_from_company(company)}
            for row, company in zip(_rows(feed), companies, strict=True)
        ]
        return ctx.respond({**feed, "stocks": stocks})

    async def verify_catalyst_claims(ctx: ResponseContext) -> ResponseResult:
        feed = await source.top_ranked()
        companies = await asyncio.gather(*[source.company(str(r["symbol"])) for r in _rows(feed)])
        symbols = [
            {
                "symbol": row["symbol"],
                "company": row.get("company"),
                **corroborate_catalyst(row, company.get("earnings")),
            }
            for row, company in zip(_rows(feed), companies, strict=True)
        ]
        return ctx.respond(
            {
                "last_updated": feed.get("last_updated"),
                "disclaimer": feed.get("disclaimer"),
                "symbols": symbols,
            }
        )

    async def detect_stale_rankings(ctx: ResponseContext) -> ResponseResult:
        feed = await source.top_ranked()
        last_updated = str(feed.get("last_updated") or "")
        companies = await asyncio.gather(*[source.company(str(r["symbol"])) for r in _rows(feed)])
        stale: list[dict[str, object]] = []
        current: list[dict[str, object]] = []
        for row, company in zip(_rows(feed), companies, strict=True):
            raw_filings = company.get("filings")
            filings = raw_filings if isinstance(raw_filings, dict) else {}
            recent = filings.get("recent")
            flagged = filings_since(last_updated, recent if isinstance(recent, list) else [])
            entry = {
                "symbol": row["symbol"],
                "company": row.get("company"),
                "filings_status": filings.get("status"),
                "feed_sec_filing_event": row.get("sec_filing_event"),
                "filings": flagged,
            }
            (stale if flagged else current).append(entry)
        return ctx.respond(
            {
                "last_updated": last_updated,
                "disclaimer": feed.get("disclaimer"),
                "stale": stale,
                "current": current,
            }
        )

    async def compare_symbols(symbols: list[str], ctx: ResponseContext) -> ResponseResult:
        requested = [_symbol(s) for s in symbols if s.strip()]
        if not requested:
            raise ValueError("symbols is required")
        feed = await source.top_ranked()
        ranked = {str(row["symbol"]): row for row in _rows(feed)}
        rows = await asyncio.gather(*[_compare_one(source, s, ranked) for s in requested])
        if all(row["status"] != "ok" for row in rows):
            raise LookupError("no requested symbols could be loaded")
        return ctx.respond(
            {
                "last_updated": feed.get("last_updated"),
                "disclaimer": feed.get("disclaimer"),
                "symbols": rows,
            }
        )

    tools = [
        (top_ranked_assets, "Top ranked assets",
         "Five model-ranked assets with selection scores, catalysts, and the feed timestamp."),
        (company_brief, "Company brief",
         "SEC-derived summary, latest earnings, and key filings for any ticker."),
        (research_top_assets, "Research top ranked assets",
         "Top 5 model-ranked assets, each enriched with a business brief."),
        (verify_catalyst_claims, "Verify catalyst claims",
         "Check each ranked catalyst against four-quarter EPS beats and misses."),
        (detect_stale_rankings, "Detect stale rankings",
         "Flag ranked symbols with SEC filings the ranking run could not have seen."),
        (compare_symbols, "Compare symbols",
         "Side-by-side business line, EPS surprise record, and latest filings."),
    ]  # fmt: skip
    for handler, title, description in tools:
        mcp.register_payable(
            handler.__name__,
            handler=handler,
            title=title,
            description=description + DISCLAIMER,
            **options,
        )


def _rows(feed: dict[str, object]) -> list[dict[str, object]]:
    stocks = feed["stocks"]
    if not isinstance(stocks, list):
        raise TypeError("ranking feed has no stocks list")
    return stocks


def _symbol(value: str) -> str:
    symbol = value.strip().upper()
    if not symbol:
        raise ValueError("symbol is required")
    return symbol


async def _compare_one(
    source: MarketDataSource, symbol: str, ranked: dict[str, dict[str, object]]
) -> dict[str, object]:
    try:
        company = await source.company(symbol)
    except CompanyNotFoundError as err:
        return {"symbol": symbol, "status": "not_found", "error": str(err)}
    row = ranked.get(symbol)
    payload: dict[str, object] = {
        "status": "ok",
        "ranked": row is not None,
        **brief_from_company(company),
    }
    if row is not None:
        payload["rank"] = row.get("rank")
        payload["selection_score"] = row.get("selection_score")
        payload["catalyst_summary"] = row.get("catalyst_summary")
    return payload


def brief_from_company(company: dict[str, object]) -> dict[str, object]:
    raw_summary = company.get("summary")
    summary = raw_summary if isinstance(raw_summary, dict) else {}
    raw_earnings = company.get("earnings")
    earnings = raw_earnings if isinstance(raw_earnings, dict) else {}
    raw_filings = company.get("filings")
    filings = raw_filings if isinstance(raw_filings, dict) else {}
    text = str(summary.get("text") or "")
    history = earnings.get("history") if isinstance(earnings.get("history"), list) else []
    beats = sum(
        1
        for row in history
        if isinstance(row, dict) and str(row.get("result", "")).lower() == "beat"
    )
    return {
        "symbol": company.get("ticker"),
        "company": company.get("company"),
        "cik": company.get("cik"),
        "summary": {
            "status": summary.get("status"),
            "text": text,
            "quality": classify_summary(text) if text else "thin",
            "ten_k_url": _ten_k_url(filings),
        },
        "earnings": {
            "status": earnings.get("status"),
            "latest": earnings.get("latest"),
            "beats": beats,
            "quarters": len(history),
        },
        "filings": {"status": filings.get("status"), "key": filings.get("key")},
        "links": company.get("links"),
    }


def _ten_k_url(filings: dict[str, object]) -> str | None:
    key = filings.get("key")
    if not isinstance(key, list):
        return None
    for item in key:
        if isinstance(item, dict) and item.get("form") == "10-K":
            url = item.get("url")
            if isinstance(url, str):
                return url
    return None
