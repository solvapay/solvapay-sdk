package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// rankedRowFields are the ranking feed's fields the tools pass on.
var rankedRowFields = []string{
	"rank",
	"symbol",
	"company",
	"sector",
	"market_cap_label",
	"price",
	"change_percent",
	"selection_score",
	"risk_level",
	"model_bias",
	"catalyst_summary",
	"trend",
	"is_official_final_pick",
	"sec_filing_event",
}

// Object is a JSON object as the upstream APIs send it.
type Object = map[string]any

// normalizeRankedFeed keeps the ranking fields, sorts by selection score
// (highest first) and lifts the timestamp and disclaimer to the top.
func normalizeRankedFeed(raw Object) (Object, error) {
	data, ok := raw["data"].(Object)
	if !ok {
		return nil, errors.New("ranking payload data must be an object")
	}
	stocksRaw, ok := data["stocks"].([]any)
	if !ok {
		return nil, errors.New("ranking payload data.stocks must be a list")
	}
	rows := make([]Object, 0, len(stocksRaw))
	for _, item := range stocksRaw {
		obj, ok := item.(Object)
		if !ok {
			return nil, errors.New("ranking row must be an object")
		}
		row := Object{}
		for _, field := range rankedRowFields {
			if v, present := obj[field]; present {
				row[field] = v
			}
		}
		if _, ok := row["selection_score"].(float64); !ok {
			return nil, fmt.Errorf("ranking row %v has no numeric selection_score", row["symbol"])
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i]["selection_score"].(float64) > rows[j]["selection_score"].(float64)
	})

	var disclaimerText any
	if disclaimer, ok := raw["disclaimer_metadata"].(Object); ok {
		disclaimerText = disclaimer["text"]
	}
	return Object{
		"stocks":                 rows,
		"market_regime":          data["market_regime"],
		"last_updated":           raw["last_updated"],
		"disclaimer":             disclaimerText,
		"official_final_symbols": data["official_final_symbols"],
	}, nil
}

// CompanyNotFoundError is Zelothorn's 404 for a ticker.
type CompanyNotFoundError struct{ Message string }

func (e *CompanyNotFoundError) Error() string { return e.Message }

// MarketDataSource is where the tools get rankings and company data.
type MarketDataSource interface {
	TopRanked(ctx context.Context) (Object, error)
	Company(ctx context.Context, symbol string) (Object, error)
}

// StubMarketData serves the recorded responses in fixtures/.
type StubMarketData struct{ Dir string }

func (s StubMarketData) TopRanked(context.Context) (Object, error) {
	raw, err := readObject(filepath.Join(s.Dir, "public.json"))
	if err != nil {
		return nil, err
	}
	return normalizeRankedFeed(raw)
}

func (s StubMarketData) Company(_ context.Context, symbol string) (Object, error) {
	path := filepath.Join(s.Dir, "company_"+strings.ToUpper(symbol)+".json")
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, &CompanyNotFoundError{fmt.Sprintf("No company found for ticker '%s'.", symbol)}
	}
	payload, err := readObject(path)
	if err != nil {
		return nil, err
	}
	if msg, ok := payload["error"].(string); ok {
		return nil, &CompanyNotFoundError{msg}
	}
	return payload, nil
}

func readObject(path string) (Object, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var obj Object
	if err := json.Unmarshal(body, &obj); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return obj, nil
}

// HTTPMarketData calls the live Top 5 Stocks and Zelothorn APIs.
type HTTPMarketData struct{ Client *http.Client }

const (
	rankingURL = "https://top5stocks.netlify.app/api/v1/stocks/public.json"
	companyURL = "https://zelothorn.com/api/v1/company/%s"
)

func (h HTTPMarketData) TopRanked(ctx context.Context) (Object, error) {
	status, body, err := h.get(ctx, rankingURL)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("ranking feed answered %d: %s", status, body)
	}
	var raw Object
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("ranking payload must be an object: %w", err)
	}
	return normalizeRankedFeed(raw)
}

func (h HTTPMarketData) Company(ctx context.Context, symbol string) (Object, error) {
	status, body, err := h.get(ctx, fmt.Sprintf(companyURL, strings.ToUpper(symbol)))
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		var payload Object
		if json.Unmarshal(body, &payload) == nil {
			if msg, ok := payload["error"].(string); ok && msg != "" {
				return nil, &CompanyNotFoundError{msg}
			}
		}
		return nil, fmt.Errorf("unexpected 404 body for ticker '%s': %s", symbol, body)
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("company API answered %d for '%s': %s", status, symbol, body)
	}
	var payload Object
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("company payload must be an object: %w", err)
	}
	return payload, nil
}

func (h HTTPMarketData) get(ctx context.Context, url string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, nil, err
	}
	resp, err := h.Client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return resp.StatusCode, body, err
}
