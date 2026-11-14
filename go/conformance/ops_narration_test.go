package conformance

// Suites narration (narrateAccount, narrateActivatePlan), pricing
// (planPricing) and business-details (validateBusinessDetails). The
// narration suite's callTool cases belong to the MCP server port.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go"
)

func init() {
	register("narrateAccount", func(t *testing.T, args map[string]any, clock *time.Time) (any, error) {
		now := time.Now()
		if clock != nil {
			now = *clock
		}
		result, err := solvapay.NarrateAccount(args["view"].(string), casePayload(t), solvapay.ParseToolMode(args["mode"]), now)
		if err != nil {
			return nil, err
		}
		return map[string]any{"content": result.Content}, nil
	})

	register("narrateActivatePlan", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		var result solvapay.ActivationResult
		recode(t, args["result"], &result)
		return solvapay.NarrateActivatePlan(result)
	})

	register("planPricing", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		plan, balance := args["plan"], args["balance"]
		meter, _ := args["meter"].(string)
		return map[string]any{
			"charges":                   solvapay.Charges(plan),
			"headlineCharges":           solvapay.HeadlineCharges(plan),
			"perUnitCharge":             solvapay.PerUnitCharge(plan, meter),
			"billingCycle":              solvapay.PlanBillingCycle(plan),
			"tierBands":                 solvapay.TierBands(plan, meter),
			"tierMeters":                solvapay.TierMeters(plan),
			"usageRate":                 solvapay.PlanUsageRate(plan, meter),
			"trialDays":                 orNull(solvapay.TrialDays(plan)),
			"includedUnits":             orNull(solvapay.IncludedUnits(plan, meter)),
			"meterName":                 emptyAsNull(solvapay.MeterName(plan)),
			"countsUsage":               solvapay.CountsUsage(plan),
			"planPricingShape":          solvapay.PlanPricingShape(plan),
			"creditsPerUnitFromBalance": orNull(solvapay.CreditsPerUnitFromBalance(plan, balance, meter)),
		}, nil
	})

	register("validateBusinessDetails", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		text := func(key string) string {
			value, _ := args[key].(string)
			return value
		}
		details, err := solvapay.ValidateBusinessDetails(solvapay.BusinessDetailsInput{
			IsBusiness:         args["isBusiness"].(bool),
			BusinessName:       text("businessName"),
			Country:            text("country"),
			CustomerCountry:    text("customerCountry"),
			CustomerName:       text("customerName"),
			CustomerState:      text("customerState"),
			CustomerPostalCode: text("customerPostalCode"),
			TaxID:              text("taxId"),
			TaxIDType:          text("taxIdType"),
		})
		var sdkErr *solvapay.Error
		if errors.As(err, &sdkErr) && sdkErr.Code == "invalid_business_details" {
			return map[string]any{"invalid": sdkErr.Message}, nil
		}
		return details, err
	})
}

// casePayload is the case's args.payload as raw JSON, read again from the
// case file: the runner hands args over as a Go map, which has lost the key
// order JSON.stringify keeps (the unknown-view case answers with the payload
// as JSON text). The subtest's name is the case's path.
func casePayload(t *testing.T) json.RawMessage {
	t.Helper()
	where := strings.TrimPrefix(t.Name(), "TestConformance/")
	raw, err := os.ReadFile(filepath.Join(casesDir, filepath.FromSlash(where)))
	if err != nil {
		t.Fatalf("reading the case for its payload: %v", err)
	}
	var data struct {
		Input struct {
			Args struct {
				Payload json.RawMessage `json:"payload"`
			} `json:"args"`
		} `json:"input"`
	}
	if err := json.Unmarshal(raw, &data); err != nil || data.Input.Args.Payload == nil {
		t.Fatalf("%s has no args.payload: %v", where, err)
	}
	return data.Input.Args.Payload
}

// recode moves a case's JSON value into a Go type, as a caller's decoder would.
func recode(t *testing.T, value, into any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
}

func orNull(value float64, ok bool) any {
	if ok {
		return value
	}
	return nil
}

func emptyAsNull(value string) any {
	if value == "" {
		return nil
	}
	return value
}
