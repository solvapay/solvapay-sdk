package solvapay_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

// TestGetMerchantConcurrent exercises the demand-grown instance pool under load.
// Run with `go test -race` to catch data races in the host-transport bridge.
func TestGetMerchantConcurrent(t *testing.T) {
	ctx := context.Background()
	var hits int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"displayName":"Acme Payments"}`))
	}))
	defer server.Close()

	client, err := solvapay.NewClient(ctx, "sk_test_123",
		solvapay.WithBaseURL(server.URL),
		solvapay.WithMaxInstances(4),
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = client.Close(ctx) }()

	const goroutines = 16
	const perGoroutine = 8
	var wg sync.WaitGroup
	errs := make(chan error, goroutines*perGoroutine)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				raw, callErr := client.GetMerchant(ctx)
				if callErr != nil {
					errs <- callErr
					return
				}
				merchant, ok := raw.(map[string]any)
				if !ok || merchant["displayName"] != "Acme Payments" {
					errs <- &solvapay.Error{Message: "unexpected merchant payload"}
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for callErr := range errs {
		t.Fatalf("concurrent GetMerchant failed: %v", callErr)
	}

	if got := atomic.LoadInt64(&hits); got != goroutines*perGoroutine {
		t.Fatalf("server hits = %d, want %d", got, goroutines*perGoroutine)
	}
}
