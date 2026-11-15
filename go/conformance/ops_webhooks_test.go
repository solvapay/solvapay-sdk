package conformance

import (
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go"
)

func init() {
	register("verifyWebhook", func(t *testing.T, args map[string]any, clock *time.Time) (any, error) {
		now := time.Time{}
		if clock != nil {
			now = *clock
		}
		signature, _ := args["signature"].(string)
		return solvapay.VerifyWebhook([]byte(args["body"].(string)), signature, args["secret"].(string), now)
	})
}
