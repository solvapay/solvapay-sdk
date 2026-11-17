package main

// The six paid research tools, registered on a SolvaPay MCP server. Each
// call is checked against the customer's plan before the handler runs, and
// billed as one unit when it succeeds.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

const disclaimer = " Educational research only, not financial advice."

// toolRegistrar is the part of *solvapay.MCPServer the tools need.
type toolRegistrar interface {
	RegisterPayable(name string, tool solvapay.PaidTool) error
}

type researchTools struct{ source MarketDataSource }

// registerTools adds the research tools. customerRef overrides who the
// customer is (tests); nil means the customer who signed in.
func registerTools(server toolRegistrar, source MarketDataSource, customerRef solvapay.CustomerRefFunc) error {
	t := researchTools{source: source}
	noArgs := map[string]any{"type": "object", "properties": map[string]any{}}
	tools := []struct {
		name, title, description string
		schema                   any
		handler                  solvapay.PaidToolHandler
	}{
		{"top_ranked_assets", "Top ranked assets",
			"Five model-ranked assets with selection scores, catalysts, and the feed timestamp.",
			noArgs, t.topRankedAssets},
		{"company_brief", "Company brief",
			"SEC-derived summary, latest earnings, and key filings for any ticker.",
			map[string]any{
				"type":       "object",
				"properties": map[string]any{"symbol": map[string]any{"type": "string"}},
				"required":   []any{"symbol"},
			}, t.companyBrief},
		{"research_top_assets", "Research top ranked assets",
			"Top 5 model-ranked assets, each enriched with a business brief.",
			noArgs, t.researchTopAssets},
		{"verify_catalyst_claims", "Verify catalyst claims",
			"Check each ranked catalyst against four-quarter EPS beats and misses.",
			noArgs, t.verifyCatalystClaims},
		{"detect_stale_rankings", "Detect stale rankings",
			"Flag ranked symbols with SEC filings the ranking run could not have seen.",
			noArgs, t.detectStaleRankings},
		{"compare_symbols", "Compare symbols",
			"Side-by-side business line, EPS surprise record, and latest filings.",
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"symbols": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
				"required": []any{"symbols"},
			}, t.compareSymbols},
	}
	for _, tool := range tools {
		err := server.RegisterPayable(tool.name, solvapay.PaidTool{
			Title:          tool.title,
			Description:    tool.description + disclaimer,
			InputSchema:    tool.schema,
			Handler:        tool.handler,
			GetCustomerRef: customerRef,
		})
		if err != nil {
			return fmt.Errorf("register %s: %w", tool.name, err)
		}
	}
	return nil
}

func (t researchTools) topRankedAssets(ctx context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	feed, err := t.source.TopRanked(ctx)
	if err != nil {
		return nil, err
	}
	return rc.Respond(feed, solvapay.RespondOptions{}), nil
}

func (t researchTools) companyBrief(ctx context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	var in struct {
		Symbol string `json:"symbol"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, err
	}
	symbol, err := normalSymbol(in.Symbol)
	if err != nil {
		return nil, err
	}
	company, err := t.source.Company(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return rc.Respond(briefFromCompany(company), solvapay.RespondOptions{}), nil
}

func (t researchTools) researchTopAssets(ctx context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	feed, rows, companies, err := t.rankedWithCompanies(ctx)
	if err != nil {
		return nil, err
	}
	stocks := make([]Object, len(rows))
	for i, row := range rows {
		enriched := Object{"brief": briefFromCompany(companies[i])}
		for k, v := range row {
			enriched[k] = v
		}
		stocks[i] = enriched
	}
	out := Object{}
	for k, v := range feed {
		out[k] = v
	}
	out["stocks"] = stocks
	return rc.Respond(out, solvapay.RespondOptions{}), nil
}

func (t researchTools) verifyCatalystClaims(ctx context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	feed, rows, companies, err := t.rankedWithCompanies(ctx)
	if err != nil {
		return nil, err
	}
	symbols := make([]Object, len(rows))
	for i, row := range rows {
		earnings, ok := companies[i]["earnings"].(Object)
		if !ok {
			return nil, fmt.Errorf("company %v has no earnings object", row["symbol"])
		}
		entry := Object{"symbol": row["symbol"], "company": row["company"]}
		for k, v := range corroborateCatalyst(row, earnings) {
			entry[k] = v
		}
		symbols[i] = entry
	}
	return rc.Respond(Object{
		"last_updated": feed["last_updated"],
		"disclaimer":   feed["disclaimer"],
		"symbols":      symbols,
	}, solvapay.RespondOptions{}), nil
}

func (t researchTools) detectStaleRankings(ctx context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	feed, rows, companies, err := t.rankedWithCompanies(ctx)
	if err != nil {
		return nil, err
	}
	lastUpdated := stringOf(feed["last_updated"])
	stale, current := []Object{}, []Object{}
	for i, row := range rows {
		filings, _ := companies[i]["filings"].(Object)
		flagged := filingsSince(lastUpdated, filings["recent"])
		entry := Object{
			"symbol":                row["symbol"],
			"company":               row["company"],
			"filings_status":        filings["status"],
			"feed_sec_filing_event": row["sec_filing_event"],
			"filings":               flagged,
		}
		if len(flagged) > 0 {
			stale = append(stale, entry)
		} else {
			current = append(current, entry)
		}
	}
	return rc.Respond(Object{
		"last_updated": lastUpdated,
		"disclaimer":   feed["disclaimer"],
		"stale":        stale,
		"current":      current,
	}, solvapay.RespondOptions{}), nil
}

func (t researchTools) compareSymbols(ctx context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
	var in struct {
		Symbols []string `json:"symbols"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, err
	}
	var requested []string
	for _, s := range in.Symbols {
		if strings.TrimSpace(s) != "" {
			requested = append(requested, strings.ToUpper(strings.TrimSpace(s)))
		}
	}
	if len(requested) == 0 {
		return nil, errors.New("symbols is required")
	}
	feed, err := t.source.TopRanked(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := feedRows(feed)
	if err != nil {
		return nil, err
	}
	ranked := map[string]Object{}
	for _, row := range rows {
		ranked[stringOf(row["symbol"])] = row
	}
	results := make([]Object, len(requested))
	errs := make([]error, len(requested))
	var wg sync.WaitGroup
	for i, symbol := range requested {
		wg.Go(func() { results[i], errs[i] = t.compareOne(ctx, symbol, ranked) })
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	anyOK := false
	for _, r := range results {
		if r["status"] == "ok" {
			anyOK = true
		}
	}
	if !anyOK {
		return nil, errors.New("no requested symbols could be loaded")
	}
	return rc.Respond(Object{
		"last_updated": feed["last_updated"],
		"disclaimer":   feed["disclaimer"],
		"symbols":      results,
	}, solvapay.RespondOptions{}), nil
}

func (t researchTools) compareOne(ctx context.Context, symbol string, ranked map[string]Object) (Object, error) {
	company, err := t.source.Company(ctx, symbol)
	var notFound *CompanyNotFoundError
	if errors.As(err, &notFound) {
		return Object{"symbol": symbol, "status": "not_found", "error": notFound.Message}, nil
	}
	if err != nil {
		return nil, err
	}
	row, isRanked := ranked[symbol]
	payload := Object{"status": "ok", "ranked": isRanked}
	for k, v := range briefFromCompany(company) {
		payload[k] = v
	}
	if isRanked {
		payload["rank"] = row["rank"]
		payload["selection_score"] = row["selection_score"]
		payload["catalyst_summary"] = row["catalyst_summary"]
	}
	return payload, nil
}

// rankedWithCompanies loads the ranking and every ranked company in parallel.
func (t researchTools) rankedWithCompanies(ctx context.Context) (Object, []Object, []Object, error) {
	feed, err := t.source.TopRanked(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	rows, err := feedRows(feed)
	if err != nil {
		return nil, nil, nil, err
	}
	companies := make([]Object, len(rows))
	errs := make([]error, len(rows))
	var wg sync.WaitGroup
	for i, row := range rows {
		wg.Go(func() { companies[i], errs[i] = t.source.Company(ctx, stringOf(row["symbol"])) })
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, nil, nil, err
	}
	return feed, rows, companies, nil
}

func feedRows(feed Object) ([]Object, error) {
	rows, ok := feed["stocks"].([]Object)
	if !ok {
		return nil, errors.New("ranking feed has no stocks list")
	}
	return rows, nil
}

func normalSymbol(value string) (string, error) {
	symbol := strings.ToUpper(strings.TrimSpace(value))
	if symbol == "" {
		return "", errors.New("symbol is required")
	}
	return symbol, nil
}

func briefFromCompany(company Object) Object {
	summary, _ := company["summary"].(Object)
	earnings, _ := company["earnings"].(Object)
	filings, _ := company["filings"].(Object)
	text := stringOf(summary["text"])
	history, _ := earnings["history"].([]any)
	beats := 0
	for _, item := range history {
		if obj, ok := item.(Object); ok && strings.EqualFold(stringOf(obj["result"]), "beat") {
			beats++
		}
	}
	quality := "thin"
	if text != "" {
		quality = classifySummary(text)
	}
	return Object{
		"symbol":  company["ticker"],
		"company": company["company"],
		"cik":     company["cik"],
		"summary": Object{
			"status":    summary["status"],
			"text":      text,
			"quality":   quality,
			"ten_k_url": tenKURL(filings),
		},
		"earnings": Object{
			"status":   earnings["status"],
			"latest":   earnings["latest"],
			"beats":    beats,
			"quarters": len(history),
		},
		"filings": Object{"status": filings["status"], "key": filings["key"]},
		"links":   company["links"],
	}
}

func tenKURL(filings Object) any {
	key, _ := filings["key"].([]any)
	for _, item := range key {
		if obj, ok := item.(Object); ok && obj["form"] == "10-K" {
			if url, ok := obj["url"].(string); ok {
				return url
			}
		}
	}
	return nil
}
