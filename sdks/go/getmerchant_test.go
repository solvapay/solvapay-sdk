package solvapay_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

func TestGetMerchantSuccess(t *testing.T) {
	ctx := context.Background()
	var gotAuth, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"displayName":"Acme Payments","country":"US"}`))
	}))
	defer server.Close()

	client, err := solvapay.NewClient(ctx, "sk_test_123", solvapay.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = client.Close(ctx) }()

	raw, err := client.GetMerchant(ctx)
	if err != nil {
		t.Fatalf("GetMerchant: %v", err)
	}
	merchant, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("GetMerchant type = %T, want map[string]any", raw)
	}
	if merchant["displayName"] != "Acme Payments" {
		t.Fatalf("displayName = %v, want Acme Payments", merchant["displayName"])
	}
	if gotPath != "/v1/sdk/merchant" {
		t.Fatalf("request path = %q, want /v1/sdk/merchant", gotPath)
	}
	if gotAuth != "Bearer sk_test_123" {
		t.Fatalf("authorization = %q, want Bearer sk_test_123", gotAuth)
	}
}

func TestGetMerchantAPIError(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"boom"}`))
	}))
	defer server.Close()

	client, err := solvapay.NewClient(ctx, "sk_test_123", solvapay.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = client.Close(ctx) }()

	_, err = client.GetMerchant(ctx)
	if err == nil {
		t.Fatal("expected API error from 500 response")
	}
	var svErr *solvapay.Error
	if !errors.As(err, &svErr) {
		t.Fatalf("error is not *solvapay.Error: %v", err)
	}
	if svErr.Status != 500 {
		t.Fatalf("status = %d, want 500", svErr.Status)
	}
}
