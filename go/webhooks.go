package solvapay

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
)

// WebhookToleranceSeconds is how far a signature's timestamp may be from now.
const WebhookToleranceSeconds = 300

// Codes VerifyWebhook fails with.
const (
	WebhookSecretMissing       = "webhook_secret_missing"
	WebhookSignatureMissing    = "webhook_signature_missing"
	WebhookSignatureMalformed  = "webhook_signature_malformed"
	WebhookTimestampOutOfRange = "webhook_timestamp_out_of_tolerance"
	WebhookSignatureInvalid    = "webhook_signature_invalid"
	WebhookPayloadInvalid      = "webhook_payload_invalid"
)

var digitsOnly = regexp.MustCompile(`^[0-9]+$`)

// VerifyWebhook verifies a SolvaPay delivery and returns the parsed event.
//
// SolvaPay signs "{t}.{raw body}" with HMAC-SHA256, keyed by the whole signing
// secret (whsec_…), and sends it in the SV-Signature header as
// "t={unix seconds},v1={lowercase hex}". now is the time to check the
// timestamp against; the zero time means the current time. An empty secret
// fails every delivery with WebhookSecretMissing.
func VerifyWebhook(body []byte, signature, secret string, now time.Time) (any, error) {
	if secret == "" {
		// HMAC accepts an empty key, so an unset secret would verify any event
		// signed with one. A misconfiguration: fail before reading the request.
		return nil, newError(WebhookSecretMissing, "Webhook secret is empty: set the endpoint signing secret (whsec_…)")
	}
	if signature == "" {
		return nil, newError(WebhookSignatureMissing, "Missing webhook signature")
	}
	var timestamp, received string
	var haveT, haveV1 bool
	for _, part := range strings.Split(signature, ",") {
		part = strings.TrimSpace(part)
		if !haveT && strings.HasPrefix(part, "t=") {
			timestamp, haveT = part[2:], true
		}
		if !haveV1 && strings.HasPrefix(part, "v1=") {
			received, haveV1 = part[3:], true
		}
	}
	if !haveT || !haveV1 || !digitsOnly.MatchString(timestamp) || received == "" {
		return nil, newError(WebhookSignatureMalformed, "Malformed webhook signature")
	}

	if now.IsZero() {
		now = time.Now()
	}
	// The timestamp may be longer than an int64; compare it exactly.
	sent, _ := new(big.Int).SetString(timestamp, 10)
	gap := new(big.Int).Sub(big.NewInt(now.Unix()), sent)
	if gap.Abs(gap).Cmp(big.NewInt(WebhookToleranceSeconds)) > 0 {
		return nil, newError(WebhookTimestampOutOfRange,
			fmt.Sprintf("Webhook signature timestamp is more than %d seconds from now", WebhookToleranceSeconds))
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(received)) {
		return nil, newError(WebhookSignatureInvalid, "Invalid webhook signature")
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var event any
	if err := decoder.Decode(&event); err != nil || decoder.More() {
		return nil, newError(WebhookPayloadInvalid, "Invalid webhook payload: body is not valid JSON")
	}
	return event, nil
}
