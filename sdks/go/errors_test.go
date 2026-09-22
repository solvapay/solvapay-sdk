package solvapay_test

import (
	"errors"
	"testing"

	solvapay "github.com/solvapay/solvapay-sdk/sdks/go"
)

func TestPaywallErrorUnwrapsAsSDKError(t *testing.T) {
	err := &solvapay.PaywallError{Message: "Payment required"}
	var svErr *solvapay.Error
	if !errors.As(err, &svErr) {
		t.Fatal("expected errors.As into *Error")
	}
	if svErr.Code != "paywall" {
		t.Fatalf("Code = %q, want paywall", svErr.Code)
	}
	if !solvapay.IsPaywallError(err) {
		t.Fatal("IsPaywallError should remain true")
	}
}
