package solvapay_test

import (
	"context"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

func TestVersionRoundTrip(t *testing.T) {
	version, err := solvapay.Version(context.Background())
	if err != nil {
		t.Fatalf("Version returned error: %v", err)
	}
	if version == "" {
		t.Fatal("Version returned empty string")
	}
	// Pinned to the guest crate version (rust/bindings/go/wasm/Cargo.toml).
	if version != "0.1.0" {
		t.Fatalf("Version = %q, want %q", version, "0.1.0")
	}
}
