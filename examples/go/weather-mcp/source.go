package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultWttrBaseURL = "https://wttr.in"
const weatherUserAgent = "solvapay-weather-mcp/0.1 (+https://github.com/solvapay/solvapay-sdk)"

type Source interface {
	Fetch(ctx context.Context, city string) (*Report, error)
}

var (
	_ Source = (*liveSource)(nil)
	_ Source = (*fixtureSource)(nil)
)

type liveSource struct {
	baseURL string
	client  *http.Client
}

func newLiveSource(baseURL string) *liveSource {
	if baseURL == "" {
		baseURL = defaultWttrBaseURL
	}
	return &liveSource{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *liveSource) Fetch(ctx context.Context, city string) (*Report, error) {
	base, err := url.Parse(s.baseURL + "/")
	if err != nil {
		return nil, fmt.Errorf("wttr.in base URL: %w", err)
	}
	rel := &url.URL{Path: city, RawQuery: "format=j1"}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.ResolveReference(rel).String(), nil)
	if err != nil {
		return nil, fmt.Errorf("wttr.in request: %w", err)
	}
	req.Header.Set("User-Agent", weatherUserAgent)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wttr.in fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("wttr.in read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wttr.in returned HTTP %d for city %q", resp.StatusCode, city)
	}
	report, err := decodeReport(body)
	if err != nil {
		return nil, err
	}
	return report, nil
}

type fixtureSource struct {
	path string
}

func newFixtureSource(path string) *fixtureSource {
	if path == "" {
		path = "fixtures/wttr-london.json"
	}
	return &fixtureSource{path: path}
}

func (s *fixtureSource) Fetch(_ context.Context, _ string) (*Report, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return nil, fmt.Errorf("read weather fixture: %w", err)
	}
	return decodeReport(raw)
}
