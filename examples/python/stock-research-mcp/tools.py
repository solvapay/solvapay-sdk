from __future__ import annotations

import asyncio
from collections.abc import Callable

from mcp.server.lowlevel.server import Server
from solvapay.facade import SolvaPay
from solvapay_mcp import ResponseContext, register_payable_tool

from analysis import classify_summary, corroborate_catalyst, filings_since
from market_data import CompanyNotFoundError, MarketDataSource

CustomerRef = str | Callable[[dict[str, object]], str]


_DISCLAIMER_SUFFIX = " Educational research only, not financial advice."


def register_tools(
    server: Server[object],
    *,
    solvapay: SolvaPay,
    product: str,
    source: MarketDataSource,
    customer_ref: CustomerRef | None = None,
) -> None:
    get_customer_ref = _customer_ref_hook(customer_ref) if customer_ref is not None else None

    async def top_ranked_assets(_args: dict[str, object], ctx: ResponseContext) -> object:
        feed = await source.top_ranked()
        return ctx.respond(feed)

    async def company_brief(args: dict[str, object], ctx: ResponseContext) -> object:
        symbol = _required_symbol(args)
        company = await source.company(symbol)
        return ctx.respond(_brief_from_company(company))

    register_payable_tool(
        server,
        "top_ranked_assets",
        solvapay=solvapay,
        product=product,
        title="Top ranked assets",
        description=(
            "Five model-ranked assets with selection scores, catalysts, and the feed timestamp."
            + _DISCLAIMER_SUFFIX
        ),
        handler=top_ranked_assets,
        get_customer_ref=get_customer_ref,
    )
    register_payable_tool(
        server,
        "company_brief",
        solvapay=solvapay,
        product=product,
        title="Company brief",
        description=(
            "SEC-derived summary, latest earnings, and key filings for any ticker."
            + _DISCLAIMER_SUFFIX
        ),
        input_schema={
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
        handler=company_brief,
        get_customer_ref=get_customer_ref,
    )

    async def research_top_assets(_args: dict[str, object], ctx: ResponseContext) -> object:
        feed = await source.top_ranked()
        companies = await asyncio.gather(
            *[source.company(str(row["symbol"])) for row in feed["stocks"]]
        )
        stocks = [
            {**row, "brief": _brief_from_company(company)}
            for row, company in zip(feed["stocks"], companies, strict=True)
        ]
        return ctx.respond({**feed, "stocks": stocks})

    async def verify_catalyst_claims(_args: dict[str, object], ctx: ResponseContext) -> object:
        feed = await source.top_ranked()
        companies = await asyncio.gather(
            *[source.company(str(row["symbol"])) for row in feed["stocks"]]
        )
        symbols = []
        for row, company in zip(feed["stocks"], companies, strict=True):
            judged = corroborate_catalyst(row, company.get("earnings"))
            symbols.append(
                {
                    "symbol": row["symbol"],
                    "company": row.get("company"),
                    **judged,
                }
            )
        return ctx.respond(
            {
                "last_updated": feed.get("last_updated"),
                "disclaimer": feed.get("disclaimer"),
                "symbols": symbols,
            }
        )

    async def detect_stale_rankings(_args: dict[str, object], ctx: ResponseContext) -> object:
        feed = await source.top_ranked()
        last_updated = str(feed.get("last_updated") or "")
        companies = await asyncio.gather(
            *[source.company(str(row["symbol"])) for row in feed["stocks"]]
        )
        stale: list[dict[str, object]] = []
        current: list[dict[str, object]] = []
        for row, company in zip(feed["stocks"], companies, strict=True):
            raw_filings = company.get("filings")
            filings = raw_filings if isinstance(raw_filings, dict) else {}
            recent = filings.get("recent") if isinstance(filings, dict) else []
            flagged = filings_since(last_updated, recent)
            entry = {
                "symbol": row["symbol"],
                "company": row.get("company"),
                "filings_status": filings.get("status"),
                "feed_sec_filing_event": row.get("sec_filing_event"),
                "filings": flagged,
            }
            if flagged:
                stale.append(entry)
            else:
                current.append(entry)
        return ctx.respond(
            {
                "last_updated": last_updated,
                "disclaimer": feed.get("disclaimer"),
                "stale": stale,
                "current": current,
            }
        )

    async def compare_symbols(args: dict[str, object], ctx: ResponseContext) -> object:
        requested = _required_symbols(args)
        feed = await source.top_ranked()
        ranked = {str(row["symbol"]): row for row in feed["stocks"]}
        rows = await asyncio.gather(
            *[_compare_one(source, symbol, ranked) for symbol in requested]
        )
        if all(row["status"] != "ok" for row in rows):
            raise LookupError("no requested symbols could be loaded")
        return ctx.respond(
            {
                "last_updated": feed.get("last_updated"),
                "disclaimer": feed.get("disclaimer"),
                "symbols": rows,
            }
        )

    register_payable_tool(
        server,
        "research_top_assets",
        solvapay=solvapay,
        product=product,
        title="Research top ranked assets",
        description=(
            "Top 5 model-ranked assets, each enriched with a business brief."
            + _DISCLAIMER_SUFFIX
        ),
        handler=research_top_assets,
        get_customer_ref=get_customer_ref,
    )
    register_payable_tool(
        server,
        "verify_catalyst_claims",
        solvapay=solvapay,
        product=product,
        title="Verify catalyst claims",
        description=(
            "Check each ranked catalyst against four-quarter EPS beats and misses."
            + _DISCLAIMER_SUFFIX
        ),
        handler=verify_catalyst_claims,
        get_customer_ref=get_customer_ref,
    )
    register_payable_tool(
        server,
        "detect_stale_rankings",
        solvapay=solvapay,
        product=product,
        title="Detect stale rankings",
        description=(
            "Flag ranked symbols with SEC filings the ranking run could not have seen."
            + _DISCLAIMER_SUFFIX
        ),
        handler=detect_stale_rankings,
        get_customer_ref=get_customer_ref,
    )
    register_payable_tool(
        server,
        "compare_symbols",
        solvapay=solvapay,
        product=product,
        title="Compare symbols",
        description=(
            "Side-by-side business line, EPS surprise record, and latest filings."
            + _DISCLAIMER_SUFFIX
        ),
        input_schema={
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["symbols"],
        },
        handler=compare_symbols,
        get_customer_ref=get_customer_ref,
    )


def _customer_ref_hook(
    customer_ref: CustomerRef,
) -> Callable[[dict[str, object]], str]:
    if callable(customer_ref):
        return customer_ref

    def _hook(_args: dict[str, object]) -> str:
        return customer_ref

    return _hook


def _required_symbol(args: dict[str, object]) -> str:
    symbol = args.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip():
        raise ValueError("symbol is required")
    return symbol.strip().upper()


def _required_symbols(args: dict[str, object]) -> list[str]:
    raw = args.get("symbols")
    if not isinstance(raw, list):
        raise ValueError("symbols is required")
    symbols = [item.strip().upper() for item in raw if isinstance(item, str) and item.strip()]
    if not symbols:
        raise ValueError("symbols is required")
    return symbols


async def _compare_one(
    source: MarketDataSource,
    symbol: str,
    ranked: dict[str, dict[str, object]],
) -> dict[str, object]:
    try:
        company = await source.company(symbol)
    except CompanyNotFoundError as err:
        return {"symbol": symbol, "status": "not_found", "error": str(err)}
    brief = _brief_from_company(company)
    row = ranked.get(symbol)
    payload: dict[str, object] = {"status": "ok", "ranked": row is not None, **brief}
    if row is not None:
        payload["rank"] = row.get("rank")
        payload["selection_score"] = row.get("selection_score")
        payload["catalyst_summary"] = row.get("catalyst_summary")
    return payload


def _brief_from_company(company: dict[str, object]) -> dict[str, object]:
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
        "filings": {
            "status": filings.get("status"),
            "key": filings.get("key"),
        },
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
