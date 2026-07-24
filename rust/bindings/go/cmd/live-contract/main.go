// Step 51 — live Go contract binary (env-gated).
//
// Env:
//
//	SOLVAPAY_SHADOW_BASE_URL   required
//	SOLVAPAY_SHADOW_API_KEY    required
//	SOLVAPAY_SHADOW_ENABLE_STRIPE  optional (`true` / `1`) to run requires:stripe
//	SOLVAPAY_LIVE_OUT          optional report path
//	  (default: contract/shadow/output/go-live-report.json)
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	solvapay "github.com/solvapay/solvapay-go"
	"github.com/solvapay/solvapay-go/internal/livecontract"
)

func main() {
	code, err := run()
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(2)
	}
	os.Exit(code)
}

func run() (int, error) {
	baseURL := os.Getenv("SOLVAPAY_SHADOW_BASE_URL")
	apiKey := os.Getenv("SOLVAPAY_SHADOW_API_KEY")
	if baseURL == "" || apiKey == "" {
		return 2, fmt.Errorf("SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required")
	}

	enableStripe := false
	switch strings.ToLower(os.Getenv("SOLVAPAY_SHADOW_ENABLE_STRIPE")) {
	case "1", "true", "yes":
		enableStripe = true
	}

	outPath := os.Getenv("SOLVAPAY_LIVE_OUT")
	if outPath == "" {
		outPath = defaultOutPath()
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return 2, fmt.Errorf("create report dir: %w", err)
	}

	ctx := context.Background()
	started := time.Now().UTC().Format(time.RFC3339)
	client, err := solvapay.NewClient(ctx, apiKey, solvapay.WithBaseURL(baseURL))
	if err != nil {
		return 2, fmt.Errorf("NewClient: %w", err)
	}
	defer func() { _ = client.Close(ctx) }()

	runID := fmt.Sprintf("%x", time.Now().UnixNano()%0xffffffff)
	refs, err := livecontract.SetupSide(ctx, client, runID)
	if err != nil {
		return 2, err
	}

	results := make([]map[string]any, 0, len(livecontract.SCENARIOS))
	failures := 0

	for _, scenario := range livecontract.SCENARIOS {
		if scenario.Requires == livecontract.RequiresStripe && !enableStripe {
			reason := scenario.SkipReason
			if reason == "" {
				reason = "requires: stripe"
			}
			results = append(results, map[string]any{
				"op": scenario.Op, "scenarioId": scenario.ID, "status": "SKIPPED", "reason": reason,
			})
			continue
		}
		if scenario.Requires == livecontract.RequiresActivePurchase {
			reason := scenario.SkipReason
			if reason == "" {
				reason = "requires: activePurchase"
			}
			results = append(results, map[string]any{
				"op": scenario.Op, "scenarioId": scenario.ID, "status": "SKIPPED", "reason": reason,
			})
			continue
		}

		argsRaw := livecontract.ResolveArgs(scenario.Args, refs)
		args, _ := argsRaw.(map[string]any)
		if args == nil {
			args = map[string]any{}
		}
		outcome := livecontract.Invoke(ctx, client, scenario.Op, args)
		status := livecontract.ScoreScenario(scenario, outcome)
		if status == "DIVERGED" {
			failures++
		}
		results = append(results, map[string]any{
			"op":         scenario.Op,
			"scenarioId": scenario.ID,
			"status":     status,
			"normalized": livecontract.Normalize(outcome),
		})

		if outcome["ok"] == true {
			if scenario.Op == "createProduct" {
				if ref := livecontract.ExtractRef(outcome["value"], []string{"reference", "productRef"}); ref != "" {
					refs["productRef"] = ref
				}
			}
			if scenario.Op == "createPlan" {
				if ref := livecontract.ExtractRef(outcome["value"], []string{"reference", "planRef"}); ref != "" {
					refs["planRef"] = ref
				}
			}
			if scenario.Op == "createCustomer" {
				if ref := livecontract.ExtractRef(outcome["value"], []string{"customerRef", "reference"}); ref != "" {
					refs["customerRef"] = ref
				}
			}
		}
	}

	finished := time.Now().UTC().Format(time.RFC3339)
	report := map[string]any{
		"startedAt":  started,
		"finishedAt": finished,
		"baseUrl":    baseURL,
		"mode":       "live",
		"side":       "go",
		"results":    results,
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return 2, fmt.Errorf("serialize report: %w", err)
	}
	if err := os.WriteFile(outPath, append(body, '\n'), 0o644); err != nil {
		return 2, fmt.Errorf("write %s: %w", outPath, err)
	}

	identical, skipped := 0, 0
	for _, r := range results {
		switch r["status"] {
		case "IDENTICAL":
			identical++
		case "SKIPPED":
			skipped++
		}
	}
	fmt.Printf(
		"go live contract: identical=%d skipped=%d failed=%d report=%s\n",
		identical, skipped, failures, outPath,
	)
	if failures > 0 {
		return 1, nil
	}
	return 0, nil
}

func defaultOutPath() string {
	// Expected cwd is rust/bindings/go (module root) → repo root is ../../..
	abs, err := filepath.Abs(filepath.Join("..", "..", "..", "contract", "shadow", "output", "go-live-report.json"))
	if err != nil {
		return "contract/shadow/output/go-live-report.json"
	}
	return abs
}
