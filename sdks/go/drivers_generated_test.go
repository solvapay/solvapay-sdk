package solvapay

import (
	"context"
	"path/filepath"
	"testing"
)

type stubGateHost struct {
	events []string
}

func (h *stubGateHost) EnsureCustomer(context.Context, string) (string, error) {
	panic("ensure should not run")
}

func (h *stubGateHost) ReadLimitsCache(key string) (bool, any, map[string]any, int64) {
	_ = key
	return true, 5.0, map[string]any{"withinLimits": true, "remaining": 5.0}, 1000
}

func (h *stubGateHost) CheckLimits(context.Context, map[string]any) (any, error) {
	panic("checkLimits should not run")
}

func (h *stubGateHost) ApplyCache(any) error {
	h.events = append(h.events, "cache")
	return nil
}

func (h *stubGateHost) NowMs() int64 { return 1010 }

func TestDriverLoopCorpusIsComplete(t *testing.T) {
	entries, err := filepath.Glob(filepath.Join("..", "..", "contract", "fixtures", "driver-loop", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 8 {
		t.Fatalf("driver-loop fixtures = %d, want 8 (%v)", len(entries), entries)
	}
}

func TestRunGeneratedGateLoopCacheHitAllow(t *testing.T) {
	host := &stubGateHost{}
	steps := []map[string]any{
		{"kind": "readLimitsCache", "key": "cus_1:prd_1:requests"},
		{"kind": "allow", "customerRef": "cus_1", "limits": map[string]any{"remaining": 4.0}},
	}
	i := 0
	_, action, err := RunGeneratedGateLoop(
		context.Background(),
		func(_ any, event map[string]any) (any, map[string]any, error) {
			host.events = append(host.events, event["kind"].(string))
			step := steps[i]
			i++
			return map[string]any{"product": "prd_1"}, step, nil
		},
		host,
		map[string]any{"kind": "start", "customerRef": "cus_1", "product": "prd_1"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if action["kind"] != "allow" {
		t.Fatalf("kind=%v", action["kind"])
	}
	found := false
	for _, e := range host.events {
		if e == "cache" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected cache apply, events=%v", host.events)
	}
}

type stubPayableHost struct{}

func (stubPayableHost) RunGate(context.Context, string, string, string) (PayableGateHostResult, error) {
	return PayableGateHostResult{Kind: "allow", CustomerRef: "cus_1", Limits: map[string]any{"remaining": 4.0}}, nil
}

func (stubPayableHost) InvokeHandler(context.Context, string, any) (PayableHandlerHostResult, error) {
	return PayableHandlerHostResult{Kind: "ok", Envelope: map[string]any{"value": true}}, nil
}

func (stubPayableHost) TrackUsage(context.Context, any) error { return nil }
func (stubPayableHost) NowMs() int64                          { return 50 }
func (stubPayableHost) RandomUnit() float64                   { return 0.25 }

func TestRunGeneratedPayableLoopRunGateInvokeDone(t *testing.T) {
	steps := []map[string]any{
		{"kind": "runGate", "customerRef": "cus_1", "product": "prd", "usageType": "requests"},
		{"kind": "invokeHandler", "customerRef": "cus_1", "limits": map[string]any{}},
		{"kind": "done", "result": map[string]any{"ok": true}, "track": map[string]any{"request": map[string]any{"units": 1.0}}},
	}
	i := 0
	result, err := RunGeneratedPayableLoop(
		context.Background(),
		func(_ any, _ map[string]any) (any, map[string]any, error) {
			step := steps[i]
			i++
			return map[string]any{}, step, nil
		},
		stubPayableHost{},
		map[string]any{"kind": "start", "customerRef": "cus_1"},
	)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := result.(map[string]any)
	if got["ok"] != true {
		t.Fatalf("result=%v", result)
	}
}
