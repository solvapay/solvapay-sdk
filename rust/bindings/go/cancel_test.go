package solvapay_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	solvapay "github.com/solvapay/solvapay-go"
)

// TestGetMerchantContextCancellation verifies that cancelling the context mid
// call surfaces the cancellation and that the pool recovers (the borrowed,
// now-dirty instance is discarded rather than reused).
func TestGetMerchantContextCancellation(t *testing.T) {
	started := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := requests.Add(1)
		if n == 1 {
			close(started)
			// Hold the first request until the client cancels it. Do not share
			// a release channel with later requests — a cancelled handler can
			// still win a select and steal the recovery signal.
			select {
			case <-r.Context().Done():
				return
			case <-time.After(5 * time.Second):
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"displayName":"Acme Payments"}`))
	}))
	defer server.Close()

	base := context.Background()
	client, err := solvapay.NewClient(base, "sk_test_123", solvapay.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = client.Close(base) }()

	ctx, cancel := context.WithCancel(base)
	errCh := make(chan error, 1)
	go func() {
		_, callErr := client.GetMerchant(ctx)
		errCh <- callErr
	}()

	<-started
	cancel()

	select {
	case callErr := <-errCh:
		if callErr == nil {
			t.Fatal("expected cancellation error, got nil")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("GetMerchant did not return after cancellation")
	}

	// The pool must recover: a fresh call on a live context still succeeds.
	raw, err := client.GetMerchant(base)
	if err != nil {
		t.Fatalf("post-cancel GetMerchant failed: %v", err)
	}
	merchant, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("GetMerchant type = %T, want map[string]any", raw)
	}
	if merchant["displayName"] != "Acme Payments" {
		t.Fatalf("displayName = %v, want Acme Payments", merchant["displayName"])
	}
}
