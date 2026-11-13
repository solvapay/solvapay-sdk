package conformance

// The paywall area: suites paywall-gate (buildPaywallGate, buildNudgeMessage)
// and paywall-sequences (scenarios: decide, paidCall, decideConcurrently,
// invalidateLimits, ensureCustomer).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go"
)

func init() {
	register("buildPaywallGate", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		return solvapay.BuildPaywallGate(args["productRef"].(string), paywallObject(t, args["limits"])), nil
	})
	register("buildNudgeMessage", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		return solvapay.BuildNudgeMessage(solvapay.PaywallStateKind(args["state"].(string)), paywallObject(t, args["limits"])), nil
	})
	scenarioRunners = append(scenarioRunners, runPaywallScenario)
}

// paywallPlain turns case JSON (json.Number) into what encoding/json decodes
// an API answer to (float64), as the SDK receives it.
func paywallPlain(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func paywallObject(t *testing.T, value any) map[string]any {
	t.Helper()
	if value == nil {
		return nil
	}
	return paywallPlain(t, value).(map[string]any)
}

func paywallInt(t *testing.T, value any) int {
	t.Helper()
	n, err := value.(json.Number).Int64()
	if err != nil {
		t.Fatalf("%v is not an integer", value)
	}
	return int(n)
}

func paywallString(args map[string]any, key string) string {
	s, _ := args[key].(string)
	return s
}

func paywallFreeLimit(t *testing.T, args map[string]any) *solvapay.FreeLimit {
	raw, ok := args["freeLimit"].(map[string]any)
	if !ok {
		return nil
	}
	limit := &solvapay.FreeLimit{
		Meter: paywallString(raw, "meter"),
		Cap:   paywallInt(t, raw["cap"]),
		Scope: paywallString(raw, "scope"),
	}
	if days, ok := raw["windowDays"]; ok {
		limit.WindowDays = paywallInt(t, days)
	}
	return limit
}

// paywallRequestID matches a request id; its 9 random characters are the only
// value a case can't fix.
var paywallRequestID = regexp.MustCompile(`^(solvapay_\d+_)[a-z0-9]{9}(:.*)?$`)

func paywallWithoutRandomness(value any) any {
	switch v := value.(type) {
	case string:
		if m := paywallRequestID.FindStringSubmatch(v); m != nil {
			return m[1] + "<random>" + m[2]
		}
		return v
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = paywallWithoutRandomness(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			out[k] = paywallWithoutRandomness(item)
		}
		return out
	}
	return value
}

// paywallAPI answers the SDK's requests from the current step's api list and
// records every request, in order.
type paywallAPI struct {
	t       *testing.T
	mu      sync.Mutex
	pending []map[string]any
	calls   []any
	// hold delays each answer, so calls started together are all waiting on
	// the first request before it returns.
	hold time.Duration
}

func (a *paywallAPI) RoundTrip(request *http.Request) (*http.Response, error) {
	call := map[string]any{"method": request.Method, "path": request.URL.Path}
	if query := request.URL.Query(); len(query) > 0 {
		values := map[string]any{}
		for key := range query {
			values[key] = query.Get(key)
		}
		call["query"] = values
	}
	if request.Body != nil {
		raw, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			body, err := decodeJSON(raw)
			if err != nil {
				a.t.Errorf("request body is not JSON: %s", raw)
				return nil, err
			}
			call["body"] = body
		}
	}
	a.mu.Lock()
	a.calls = append(a.calls, call)
	var exchange map[string]any
	for i, candidate := range a.pending {
		if candidate["method"] == request.Method && candidate["path"] == request.URL.Path {
			exchange = candidate
			a.pending = append(a.pending[:i:i], a.pending[i+1:]...)
			break
		}
	}
	hold := a.hold
	a.mu.Unlock()
	if exchange == nil {
		a.t.Errorf("unexpected API call: %s %s", request.Method, request.URL.Path)
		return nil, fmt.Errorf("unexpected API call: %s %s", request.Method, request.URL.Path)
	}
	time.Sleep(hold)
	status := http.StatusOK
	if raw, ok := exchange["status"]; ok {
		status = paywallInt(a.t, raw)
	}
	body, err := json.Marshal(exchange["body"])
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(body)),
		Request:    request,
	}, nil
}

func runPaywallScenario(t *testing.T, data map[string]any) ([]any, bool) {
	if data["suite"] != "paywall-sequences" {
		return nil, false
	}
	setup := data["setup"].(map[string]any)
	product := setup["productRef"].(string)
	// The product comes from the case only, never from this machine's environment.
	t.Setenv("SOLVAPAY_PRODUCT_REF", "")

	stub := &paywallAPI{t: t}
	zero := 0
	client, err := solvapay.NewClient(solvapay.Config{
		APIKey:     "sk_sandbox_conformance",
		APIBaseURL: "https://api.conformance.test",
		MaxRetries: &zero, // TypeScript never retries; see Known divergences
		HTTPClient: &http.Client{Transport: stub},
	})
	if err != nil {
		t.Fatal(err)
	}
	var clockMu sync.Mutex
	var now time.Time
	options := solvapay.PaywallOptions{
		ProductRef: product,
		Now: func() time.Time {
			clockMu.Lock()
			defer clockMu.Unlock()
			return now
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if ttl, ok := setup["limitsCacheTtlMs"]; ok {
		options.LimitsCacheTTL = time.Duration(paywallInt(t, ttl)) * time.Millisecond
	}
	paywall, err := solvapay.NewPaywall(client, options)
	if err != nil {
		t.Fatal(err)
	}

	var outcomes []any
	for index, raw := range data["steps"].([]any) {
		step := raw.(map[string]any)
		clock, err := time.Parse(time.RFC3339Nano, step["clock"].(string))
		if err != nil {
			t.Fatal(err)
		}
		clockMu.Lock()
		now = clock
		clockMu.Unlock()
		stub.mu.Lock()
		stub.pending = nil
		if api, ok := step["api"].([]any); ok {
			for _, exchange := range api {
				stub.pending = append(stub.pending, exchange.(map[string]any))
			}
		}
		stub.calls = []any{}
		stub.hold = 0
		stub.mu.Unlock()

		fn := step["fn"].(string)
		outcome, err := paywallStep(t, paywall, stub, product, fn, step["args"].(map[string]any))
		if err != nil {
			var sdkErr *solvapay.Error
			if !errors.As(err, &sdkErr) {
				t.Fatalf("step %d (%s): an error without a code: %v", index+1, fn, err)
			}
			outcome = map[string]any{"error": map[string]any{"code": sdkErr.Code}}
		}
		stub.mu.Lock()
		if len(stub.pending) > 0 {
			t.Fatalf("step %d (%s): API exchanges not used: %v", index+1, fn, stub.pending)
		}
		outcome["apiCalls"] = stub.calls
		stub.mu.Unlock()
		outcomes = append(outcomes, paywallWithoutRandomness(outcome))
	}
	return outcomes, true
}

func paywallDecisionResult(decision solvapay.Decision) map[string]any {
	result := map[string]any{"outcome": string(decision.Outcome), "customerRef": decision.CustomerRef}
	if decision.Consequence != "" {
		result["consequence"] = decision.Consequence
	}
	if decision.Gate != nil {
		result["gate"] = decision.Gate
	}
	return result
}

func paywallStep(t *testing.T, paywall *solvapay.Paywall, stub *paywallAPI, product, fn string, args map[string]any) (map[string]any, error) {
	ctx := context.Background()
	switch fn {
	case "decide":
		decision, err := paywall.Decide(ctx, solvapay.DecideParams{
			CustomerRef: paywallString(args, "customerRef"),
			Product:     product,
			Meter:       paywallString(args, "meter"),
			FreeLimit:   paywallFreeLimit(t, args),
			ToolName:    paywallString(args, "toolName"),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": paywallDecisionResult(decision)}, nil

	case "paidCall":
		mode := paywallString(args, "handler")
		paid, err := solvapay.Payable(paywall, solvapay.PayableOptions{
			Product:   product,
			Meter:     paywallString(args, "meter"),
			FreeLimit: paywallFreeLimit(t, args),
			ToolName:  paywallString(args, "toolName"),
		}, func(ctx context.Context, call solvapay.PaidCall[struct{}]) (map[string]any, error) {
			switch mode {
			case "fail":
				return nil, &solvapay.Error{Code: "handler_failed", Message: "the handler failed"}
			case "gate":
				// The handler gates the call itself.
				return nil, solvapay.NewPaywallError(solvapay.BuildPaywallGate(product, map[string]any{"withinLimits": false, "remaining": float64(0)}))
			}
			return map[string]any{"ok": true}, nil
		})
		if err != nil {
			return nil, err
		}
		result, err := paid(ctx, solvapay.PaidCall[struct{}]{CustomerRef: paywallString(args, "customerRef")})
		var gated *solvapay.PaywallError
		if errors.As(err, &gated) {
			return map[string]any{"gate": gated.Gate}, nil
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": result}, nil

	case "decideConcurrently":
		// count calls for one customer start together, as parallel tool calls
		// do. Go has no start order for goroutines, so each starts a moment
		// after the one before while the API holds its answers: they reach the
		// shared limits check in order, as the other SDKs' tasks do.
		count := paywallInt(t, args["count"])
		stub.mu.Lock()
		stub.hold = time.Duration(20*count+40) * time.Millisecond
		stub.mu.Unlock()
		outcomes := make([]any, count)
		errs := make([]error, count)
		var wg sync.WaitGroup
		for i := range count {
			wg.Add(1)
			go func() {
				defer wg.Done()
				time.Sleep(time.Duration(i*20) * time.Millisecond)
				decision, err := paywall.Decide(ctx, solvapay.DecideParams{
					CustomerRef: paywallString(args, "customerRef"),
					Product:     product,
					Meter:       paywallString(args, "meter"),
				})
				outcomes[i], errs[i] = string(decision.Outcome), err
			}()
		}
		wg.Wait()
		if err := errors.Join(errs...); err != nil {
			return nil, err
		}
		return map[string]any{"result": outcomes}, nil

	case "invalidateLimits":
		paywall.InvalidateLimits(paywallString(args, "customerRef"), paywallString(args, "productRef"))
		return map[string]any{"result": nil}, nil

	case "ensureCustomer":
		ref, err := paywall.EnsureCustomer(ctx, paywallString(args, "customerRef"), solvapay.EnsureCustomerOptions{
			ExternalRef: paywallString(args, "externalRef"),
			Email:       paywallString(args, "email"),
			Name:        paywallString(args, "name"),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": ref}, nil
	}
	t.Fatalf("no Go mapping for paywall scenario step %q", fn)
	return nil, nil
}
