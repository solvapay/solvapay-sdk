package solvapay_test

import (
	"context"
	"os"
	"strings"
	"testing"

	solvapay "github.com/solvapay/solvapay-sdk/sdks/go"
)

func TestPanicProbeSurfacesAsError(t *testing.T) {
	err := solvapay.PanicProbe(context.Background())
	if err == nil {
		t.Fatal("expected panic probe to return an error")
	}
	msg := err.Error()
	if strings.Contains(msg, "not found") || strings.Contains(msg, "not exported") ||
		strings.Contains(msg, "unknown function") || strings.Contains(msg, "missing export") {
		if os.Getenv("SOLVAPAY_REQUIRE_PANIC_PROBE") == "1" {
			t.Fatalf("panic probe export missing: %s", msg)
		}
		t.Skip("guest built without panic-probe")
	}
}
