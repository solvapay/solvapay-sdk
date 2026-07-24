package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

func TestExampleRunReturnsGetMerchantFields(t *testing.T) {
	ctx := context.Background()
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"displayName":"Example Merchant","defaultCurrency":"usd"}`))
	}))
	defer server.Close()

	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(server.URL))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = client.Close(ctx) }()

	merchant, err := run(ctx, client)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if merchant["displayName"] != "Example Merchant" {
		t.Fatalf("displayName = %v, want Example Merchant", merchant["displayName"])
	}
	if merchant["defaultCurrency"] != "usd" {
		t.Fatalf("defaultCurrency = %v, want usd", merchant["defaultCurrency"])
	}
	if gotPath != "/v1/sdk/merchant" {
		t.Fatalf("request path = %q, want /v1/sdk/merchant", gotPath)
	}
}
