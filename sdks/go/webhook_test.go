package solvapay_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

const (
	webhookSecret = "whsec_test_fixture_secret"
	webhookNow    = int64(1782864000)
	webhookBody   = `{"type":"purchase.created","id":"evt_fixture_1"}`
)

// sign produces a valid `t=…,v1=…` header for body at timestamp ts.
func sign(secret, body string, ts int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.%s", ts, body)))
	return fmt.Sprintf("t=%d,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func TestVerifyWebhookAccepts(t *testing.T) {
	ctx := context.Background()
	signature := sign(webhookSecret, webhookBody, webhookNow)
	event, err := solvapay.VerifyWebhook(ctx, webhookBody, signature, webhookSecret, webhookNow)
	if err != nil {
		t.Fatalf("VerifyWebhook returned error: %v", err)
	}
	if event["type"] != "purchase.created" {
		t.Fatalf("event type = %v, want purchase.created", event["type"])
	}
	if event["id"] != "evt_fixture_1" {
		t.Fatalf("event id = %v, want evt_fixture_1", event["id"])
	}
}

func TestVerifyWebhookErrorCodes(t *testing.T) {
	ctx := context.Background()
	zeros := make([]byte, 32)
	badHex := hex.EncodeToString(zeros)

	cases := []struct {
		name      string
		body      string
		signature string
		wantCode  string
	}{
		{"missing", webhookBody, "", "missing_signature"},
		{"malformed", webhookBody, "not-a-signature", "malformed_signature"},
		{"tooOld", webhookBody, sign(webhookSecret, webhookBody, webhookNow-1000), "timestamp_too_old"},
		{"invalidSig", webhookBody, fmt.Sprintf("t=%d,v1=%s", webhookNow, badHex), "invalid_signature"},
		{"invalidPayload", "not-json", sign(webhookSecret, "not-json", webhookNow), "invalid_payload"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := solvapay.VerifyWebhook(ctx, tc.body, tc.signature, webhookSecret, webhookNow)
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
			var svErr *solvapay.Error
			if !errors.As(err, &svErr) {
				t.Fatalf("error is not *solvapay.Error: %v", err)
			}
			if svErr.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q (message: %q)", svErr.Code, tc.wantCode, svErr.Message)
			}
		})
	}
}
