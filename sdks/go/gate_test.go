package solvapay_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	solvapay "github.com/solvapay/solvapay-go"
)

type gateMock struct {
	limits        map[string]any
	customerRef   string
	mu            sync.Mutex
	tracked       []map[string]any
	limitsCalls   atomic.Int32
	customerGets  atomic.Int32
	customerPosts atomic.Int32
}

func (m *gateMock) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			m.limitsCalls.Add(1)
			_ = json.NewEncoder(w).Encode(m.limits)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			body, _ := io.ReadAll(r.Body)
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			m.mu.Lock()
			m.tracked = append(m.tracked, payload)
			m.mu.Unlock()
			_, _ = w.Write([]byte(`{"reference":"usg_test","outcome":"success"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			m.customerGets.Add(1)
			ref := m.customerRef
			if ref == "" {
				ref = "cus_ensured"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"reference":   ref,
				"email":       "a@example.com",
				"externalRef": r.URL.Query().Get("externalRef"),
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/customers":
			m.customerPosts.Add(1)
			ref := m.customerRef
			if ref == "" {
				ref = "cus_created"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"reference": ref,
				"email":     "created@example.com",
			})
		default:
			http.NotFound(w, r)
		}
	})
}

func (m *gateMock) trackedCopy() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]any, len(m.tracked))
	copy(out, m.tracked)
	return out
}

func newGateClient(t *testing.T, mock *gateMock) *solvapay.Client {
	t.Helper()
	srv := httptest.NewServer(mock.handler())
	t.Cleanup(srv.Close)
	ctx := context.Background()
	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(srv.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close(ctx) })
	return client
}

func assertVolatile(t *testing.T, payload map[string]any) {
	t.Helper()
	if _, ok := payload["duration"]; !ok {
		t.Fatal("missing duration")
	}
	if _, ok := payload["timestamp"]; !ok {
		t.Fatal("missing timestamp")
	}
	meta, _ := payload["metadata"].(map[string]any)
	if _, ok := meta["requestId"]; !ok {
		t.Fatal("missing metadata.requestId")
	}
}

func TestGateAllowTrackUsageMatchesContract(t *testing.T) {
	mock := &gateMock{limits: map[string]any{
		"withinLimits": true,
		"remaining":    3,
		"meterName":    "requests",
		"checkoutUrl":  "https://pay.example/x",
	}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"})
	if err != nil {
		t.Fatalf("Gate: %v", err)
	}
	allow, ok := out.(*solvapay.Allow)
	if !ok {
		t.Fatalf("outcome type %T, want *Allow", out)
	}
	dur := 12.0
	if err := allow.TrackSuccess(ctx, solvapay.TrackOpts{Duration: &dur}); err != nil {
		t.Fatalf("TrackSuccess: %v", err)
	}
	tracked := mock.trackedCopy()
	if len(tracked) != 1 {
		t.Fatalf("tracked = %d, want 1", len(tracked))
	}
	payload := tracked[0]
	if payload["customerRef"] != "cus_abc" {
		t.Fatalf("customerRef = %v", payload["customerRef"])
	}
	if payload["actionType"] != "api_call" {
		t.Fatalf("actionType = %v", payload["actionType"])
	}
	if payload["units"] != float64(1) {
		t.Fatalf("units = %v", payload["units"])
	}
	if payload["outcome"] != "success" {
		t.Fatalf("outcome = %v", payload["outcome"])
	}
	if payload["productRef"] != "prd_demo" {
		t.Fatalf("productRef = %v", payload["productRef"])
	}
	meta, _ := payload["metadata"].(map[string]any)
	if meta["action"] != "requests" {
		t.Fatalf("metadata.action = %v", meta["action"])
	}
	assertVolatile(t, payload)
}

func TestGateTrackFailOutcome(t *testing.T) {
	mock := &gateMock{limits: map[string]any{"withinLimits": true, "remaining": 3}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"})
	if err != nil {
		t.Fatalf("Gate: %v", err)
	}
	allow := out.(*solvapay.Allow)
	dur := 8.0
	if err := allow.TrackFail(ctx, errors.New("boom"), solvapay.TrackOpts{Duration: &dur}); err != nil {
		t.Fatalf("TrackFail: %v", err)
	}
	payload := mock.trackedCopy()[0]
	if payload["outcome"] != "fail" {
		t.Fatalf("outcome = %v", payload["outcome"])
	}
	assertVolatile(t, payload)
}

func TestGateTrackFailPaywallErrorSkipsUsage(t *testing.T) {
	mock := &gateMock{limits: map[string]any{"withinLimits": true, "remaining": 3}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"})
	if err != nil {
		t.Fatalf("Gate: %v", err)
	}
	allow := out.(*solvapay.Allow)
	if err := allow.TrackFail(ctx, &solvapay.PaywallError{Message: "Payment required"}, solvapay.TrackOpts{}); err != nil {
		t.Fatalf("TrackFail: %v", err)
	}
	if got := len(mock.trackedCopy()); got != 0 {
		t.Fatalf("tracked = %d, want 0 (skipUsage)", got)
	}
}

func TestGatePaywallTracksUsage(t *testing.T) {
	mock := &gateMock{limits: map[string]any{
		"withinLimits": false,
		"remaining":    0,
		"checkoutUrl":  "https://pay.example/x",
	}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"})
	if err != nil {
		t.Fatalf("Gate: %v", err)
	}
	if _, ok := out.(*solvapay.Paywall); !ok {
		t.Fatalf("outcome type %T, want *Paywall", out)
	}
	tracked := mock.trackedCopy()
	if len(tracked) != 1 {
		t.Fatalf("tracked = %d, want 1", len(tracked))
	}
	payload := tracked[0]
	if payload["outcome"] != "paywall" {
		t.Fatalf("outcome = %v", payload["outcome"])
	}
	if payload["customerRef"] != "cus_abc" {
		t.Fatalf("customerRef = %v", payload["customerRef"])
	}
	assertVolatile(t, payload)
}

func TestGateLimitsCacheHitSkipsSecondCheck(t *testing.T) {
	mock := &gateMock{limits: map[string]any{"withinLimits": true, "remaining": 5}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	if _, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"}); err != nil {
		t.Fatalf("first Gate: %v", err)
	}
	if _, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"}); err != nil {
		t.Fatalf("second Gate: %v", err)
	}
	if got := mock.limitsCalls.Load(); got != 1 {
		t.Fatalf("checkLimits calls = %d, want 1 (cache hit)", got)
	}
}

func TestGateRejectsNonObjectLimits(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	ctx := context.Background()
	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(srv.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close(ctx) })
	_, err = client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"})
	if err == nil || !strings.Contains(err.Error(), "non-object") {
		t.Fatalf("err = %v, want non-object body", err)
	}
}

func TestGateEnsureCustomerSkipsBackendRef(t *testing.T) {
	mock := &gateMock{limits: map[string]any{"withinLimits": true, "remaining": 5}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	if _, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_demo"}); err != nil {
		t.Fatalf("Gate: %v", err)
	}
	if mock.customerGets.Load() != 0 || mock.customerPosts.Load() != 0 {
		t.Fatalf("backend ref should skip get/create customer")
	}
}

func TestGateEnsureCustomerLooksUpExternalRef(t *testing.T) {
	mock := &gateMock{
		limits:      map[string]any{"withinLimits": true, "remaining": 5},
		customerRef: "cus_looked_up",
	}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Gate(ctx, "user_ext", solvapay.GateOpts{Product: "prd_demo"})
	if err != nil {
		t.Fatalf("Gate: %v", err)
	}
	allow, ok := out.(*solvapay.Allow)
	if !ok {
		t.Fatalf("outcome type %T", out)
	}
	if allow.Customer().Ref != "cus_looked_up" {
		t.Fatalf("backend ref = %q", allow.Customer().Ref)
	}
	if mock.customerGets.Load() < 1 {
		t.Fatal("expected getCustomer")
	}
}

func TestGateCustomerDedupCoalescesInflight(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var gets atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			gets.Add(1)
			started <- struct{}{}
			<-release
			_, _ = w.Write([]byte(`{"reference":"cus_slow","email":"a@example.com"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_, _ = w.Write([]byte(`{"withinLimits":true,"remaining":5}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			_, _ = w.Write([]byte(`{"reference":"usg"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	ctx := context.Background()
	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(srv.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close(ctx) })

	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			_, err := client.Gate(ctx, "user_parallel", solvapay.GateOpts{Product: "prd_demo"})
			errs <- err
		}()
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for first getCustomer")
	}
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("Gate: %v", err)
		}
	}
	if got := gets.Load(); got != 1 {
		t.Fatalf("getCustomer calls = %d, want 1 (inflight coalescing)", got)
	}
}

func TestPayableDelegatesToGate(t *testing.T) {
	mock := &gateMock{limits: map[string]any{"withinLimits": true, "remaining": 2}}
	client := newGateClient(t, mock)
	ctx := context.Background()
	out, err := client.Payable("prd_demo", "").Gate(ctx, "cus_abc")
	if err != nil {
		t.Fatalf("Payable.Gate: %v", err)
	}
	if _, ok := out.(*solvapay.Allow); !ok {
		t.Fatalf("outcome type %T", out)
	}
}
