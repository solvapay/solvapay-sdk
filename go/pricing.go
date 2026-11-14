package solvapay

// Readers for a plan's options[] pricing, ported from @solvapay/core's
// pricing-options.ts.
//
// Every plan-shaped payload (a catalog plan, the frozen planSnapshot on a
// purchase) describes its pricing as an ordered list of options, each with a
// kind. These readers take the plan as decoded JSON (map[string]any) or any
// value that marshals to it, such as a generated API model, and read it
// structurally as TypeScript does: an option kind or a malformed field this
// version does not know is skipped, never an error. They answer with typed
// values whose JSON is TypeScript's.

import (
	"sort"
	"strings"
)

// Charge is a charge option. AmountMinor is in Currency's minor units; for a
// per-unit charge it is the metered rate, not a credit amount.
type Charge struct {
	Per         string  `json:"per"` // flat, unit or seat
	AmountMinor float64 `json:"amountMinor"`
	Currency    string  `json:"currency"`
	Meter       string  `json:"meter,omitempty"`
	OneTime     bool    `json:"oneTime,omitempty"`
}

// BillingCycle is a recurring plan's cycle. Count is set only above 1.
type BillingCycle struct {
	Interval string  `json:"interval"` // week, month or year
	Count    float64 `json:"count,omitempty"`
}

// TierBand is one band of a tiered price: [From, To) metered units, To nil
// for the unbounded top band, the rate on an embedded per-unit charge.
type TierBand struct {
	From   float64  `json:"from"`
	To     *float64 `json:"to"`
	Mode   string   `json:"mode"` // graduated or volume
	Charge Charge   `json:"charge"`
}

// UsageRate is what one metered unit costs. Tiered means later bands may
// cost differently, so present AmountMinor as a floor ("from $0.02").
type UsageRate struct {
	Charge
	Tiered bool `json:"tiered"`
}

// PricingShape is a plan's pricing at a glance. Shape is free, usage,
// recurring, hybrid or oneTime.
type PricingShape struct {
	Shape         string        `json:"shape"`
	HeadlineMinor float64       `json:"headlineMinor"`
	Currency      string        `json:"currency"`
	Cycle         *BillingCycle `json:"cycle"`
	Rate          *UsageRate    `json:"rate"`
}

func pricingOptions(plan any) []map[string]any {
	plan = asJSONValue(plan)
	var out []map[string]any
	switch options := jsGet(plan, "options").(type) {
	case []any:
		for _, option := range options {
			if m, ok := option.(map[string]any); ok {
				out = append(out, m)
			}
		}
	case []map[string]any:
		out = options
	}
	return out
}

// asJSONValue reads a Go value as its JSON; a value that does not marshal reads as null.
func asJSONValue(v any) any {
	out, err := jsonValue(v)
	if err != nil {
		return nil
	}
	return out
}

func chargeFields(option map[string]any) *Charge {
	per, _ := option["per"].(string)
	if per != "flat" && per != "unit" && per != "seat" {
		return nil
	}
	amount, ok := jsNum(option["amountMinor"])
	currency, isString := option["currency"].(string)
	if !ok || !isString {
		return nil
	}
	charge := &Charge{Per: per, AmountMinor: amount, Currency: currency}
	if meter, ok := option["meter"].(string); ok {
		charge.Meter = meter
	}
	charge.OneTime = option["oneTime"] == true
	return charge
}

func asCharge(option map[string]any) *Charge {
	if option["kind"] != "charge" {
		return nil
	}
	return chargeFields(option)
}

// Charges is every charge option on the plan, in wire order.
func Charges(plan any) []Charge {
	out := []Charge{}
	for _, option := range pricingOptions(plan) {
		if charge := asCharge(option); charge != nil {
			out = append(out, *charge)
		}
	}
	return out
}

// HeadlineCharges is the base flat charge in each currency, first seen
// first. Setup fees (oneTime beside a base charge) are not the headline.
func HeadlineCharges(plan any) []Charge {
	var flat, base []Charge
	for _, charge := range Charges(plan) {
		if charge.Per == "flat" {
			flat = append(flat, charge)
			if !charge.OneTime {
				base = append(base, charge)
			}
		}
	}
	source := base
	if len(base) == 0 {
		source = flat
	}
	out := []Charge{}
	seen := map[string]bool{}
	for _, charge := range source {
		key := strings.ToUpper(charge.Currency)
		if !seen[key] {
			seen[key] = true
			out = append(out, charge)
		}
	}
	return out
}

// PerUnitCharge is the first per-unit charge, for meter when it is not ""; nil when there is none.
func PerUnitCharge(plan any, meter string) *Charge {
	for _, charge := range Charges(plan) {
		if charge.Per == "unit" && (meter == "" || charge.Meter == meter) {
			return &charge
		}
	}
	return nil
}

// PlanBillingCycle is the plan's billing cycle, or nil for a one-time or pure usage plan.
func PlanBillingCycle(plan any) *BillingCycle {
	for _, option := range pricingOptions(plan) {
		if option["kind"] != "billingCycle" {
			continue
		}
		interval, _ := option["interval"].(string)
		if interval != "week" && interval != "month" && interval != "year" {
			continue
		}
		cycle := &BillingCycle{Interval: interval}
		if count, ok := jsNum(option["count"]); ok && count > 1 {
			cycle.Count = count
		}
		return cycle
	}
	return nil
}

func asTier(option map[string]any) *TierBand {
	if option["kind"] != "tier" {
		return nil
	}
	from, ok := jsNum(option["from"])
	if !ok {
		return nil
	}
	var to *float64
	if end, present := option["to"]; !present || end != nil {
		n, ok := jsNum(end)
		if !ok {
			return nil // undefined is neither null nor a number
		}
		to = &n
	}
	mode, _ := option["mode"].(string)
	if mode != "graduated" && mode != "volume" {
		return nil
	}
	embedded, ok := option["charge"].(map[string]any)
	if !ok {
		return nil
	}
	charge := chargeFields(embedded)
	if charge == nil {
		return nil
	}
	return &TierBand{From: from, To: to, Mode: mode, Charge: *charge}
}

func allTiers(plan any) []TierBand {
	var out []TierBand
	for _, option := range pricingOptions(plan) {
		if tier := asTier(option); tier != nil {
			out = append(out, *tier)
		}
	}
	return out
}

// TierBands is the bands meter (else the first tiered meter) is priced in,
// ordered by floor. It never mixes two meters' bands.
func TierBands(plan any, meter string) []TierBand {
	all := allTiers(plan)
	out := []TierBand{}
	if len(all) == 0 {
		return out
	}
	target := meter
	if target == "" {
		target = all[0].Charge.Meter
	}
	for _, tier := range all {
		if target == "" || tier.Charge.Meter == target {
			out = append(out, tier)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out
}

// TierMeters is every meter the plan prices with tier bands, first seen first.
func TierMeters(plan any) []string {
	seen := []string{}
	for _, tier := range allTiers(plan) {
		if meter := tier.Charge.Meter; meter != "" && !contains(seen, meter) {
			seen = append(seen, meter)
		}
	}
	return seen
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// PlanUsageRate is what one metered unit costs: a paying per-unit charge,
// else the first paying band, else the zero per-unit charge; nil when the
// plan prices no usage.
func PlanUsageRate(plan any, meter string) *UsageRate {
	charge := PerUnitCharge(plan, meter)
	if charge != nil && charge.AmountMinor > 0 {
		return &UsageRate{Charge: *charge}
	}
	var paying []TierBand
	for _, band := range TierBands(plan, meter) {
		if band.Charge.AmountMinor > 0 {
			paying = append(paying, band)
		}
	}
	if len(paying) > 0 {
		return &UsageRate{Charge: paying[0].Charge, Tiered: len(paying) > 1}
	}
	if charge != nil {
		return &UsageRate{Charge: *charge}
	}
	return nil
}

// TrialDays is the free trial's length in days; false without a trial.
func TrialDays(plan any) (float64, bool) {
	for _, option := range pricingOptions(plan) {
		if option["kind"] != "trial" {
			continue
		}
		if days, ok := jsNum(option["days"]); ok && days > 0 {
			return days, true
		}
	}
	return 0, false
}

func firstLimit(plan any, meter string) (cap float64, limitMeter string, ok bool) {
	for _, option := range pricingOptions(plan) {
		if option["kind"] != "limit" {
			continue
		}
		if meter != "" && option["meter"] != meter {
			continue
		}
		cap, isNumber := jsNum(option["cap"])
		if !isNumber {
			continue
		}
		name, _ := option["meter"].(string)
		return cap, name, true
	}
	return 0, "", false
}

// IncludedUnits is the units the plan's limit includes (for meter, when not
// ""); 0 means unlimited, false means the plan has no limit.
func IncludedUnits(plan any, meter string) (float64, bool) {
	cap, _, ok := firstLimit(plan, meter)
	return cap, ok
}

// MeterName is the meter the plan counts against: its per-unit charge's,
// else its first tiered meter, else its limit's; "" when there is none.
func MeterName(plan any) string {
	if charge := PerUnitCharge(plan, ""); charge != nil && charge.Meter != "" {
		return charge.Meter
	}
	if meters := TierMeters(plan); len(meters) > 0 {
		return meters[0]
	}
	_, meter, _ := firstLimit(plan, "")
	return meter
}

// CountsUsage reports whether the plan counts usage: a per-unit charge, a limit or a tier.
func CountsUsage(plan any) bool {
	if PerUnitCharge(plan, "") != nil {
		return true
	}
	if _, ok := IncludedUnits(plan, ""); ok {
		return true
	}
	return len(TierBands(plan, "")) > 0
}

// PeggedCreditsPerUnit is credits per metered unit, as the platform's debit
// engine computes them from the charge and the balance peg.
func PeggedCreditsPerUnit(chargeMinor, creditsPerMinorUnit, usdToChargeRate float64) float64 {
	if !(chargeMinor > 0) || !(creditsPerMinorUnit > 0) {
		return 0
	}
	rate := usdToChargeRate
	if !(rate > 0) {
		rate = 1
	}
	return jsRound(chargeMinor / rate * creditsPerMinorUnit)
}

func isMetered(plan any) bool {
	return PerUnitCharge(plan, "") != nil || len(TierBands(plan, "")) > 0
}

func isBillableMetered(plan any) bool {
	if rate := PlanUsageRate(plan, ""); rate != nil && rate.AmountMinor > 0 {
		return true
	}
	for _, band := range TierBands(plan, "") {
		if band.Charge.AmountMinor > 0 {
			return true
		}
	}
	return false
}

func headlinePriceMinor(plan any) float64 {
	recurring := PlanBillingCycle(plan) != nil
	for _, charge := range Charges(plan) {
		if charge.Per == "flat" && (!recurring || !charge.OneTime) {
			return charge.AmountMinor
		}
	}
	return 0
}

// PlanPricingShape classifies the plan's pricing and picks its headline price.
func PlanPricingShape(plan any) PricingShape {
	plan = asJSONValue(plan)
	fallback := "USD"
	if currency := jsGet(plan, "currency"); !jsNullish(currency) {
		fallback = strings.ToUpper(jsString(currency))
	}
	if !jsTruthy(plan) {
		return PricingShape{Shape: "oneTime", Currency: fallback}
	}
	if jsGet(plan, "requiresPayment") == false {
		return PricingShape{Shape: "free", Currency: fallback, Cycle: PlanBillingCycle(plan), Rate: PlanUsageRate(plan, "")}
	}
	cycle := PlanBillingCycle(plan)
	metered := isMetered(plan)
	shape := "oneTime"
	switch {
	case cycle != nil && isBillableMetered(plan):
		shape = "hybrid"
	case cycle != nil:
		shape = "recurring"
	case metered:
		shape = "usage"
	}
	currency := fallback
	if headline := HeadlineCharges(plan); len(headline) > 0 {
		currency = strings.ToUpper(headline[0].Currency)
	}
	out := PricingShape{Shape: shape, HeadlineMinor: headlinePriceMinor(plan), Currency: currency, Cycle: cycle}
	if metered {
		out.Rate = PlanUsageRate(plan, "")
	}
	return out
}

// CreditsPerUnitFromBalance is credits per metered call against the
// customer's balance peg (displayCurrency, creditsPerMinorUnit,
// displayExchangeRate); false when the plan prices no usage or prices it in
// another currency than the balance's (the SDK does not hold that FX rate).
func CreditsPerUnitFromBalance(plan, balance any, meter string) (float64, bool) {
	charge := PlanUsageRate(plan, meter)
	if charge == nil || !(charge.AmountMinor > 0) {
		return 0, false
	}
	balance = asJSONValue(balance)
	displayCurrency, isString := jsGet(balance, "displayCurrency").(string)
	perMinor, isNumber := jsNum(jsGet(balance, "creditsPerMinorUnit"))
	if !isString || !isNumber {
		return 0, false
	}
	if strings.ToUpper(charge.Currency) != strings.ToUpper(displayCurrency) {
		return 0, false
	}
	rate := jsNumber(jsCoalesce(jsGet(balance, "displayExchangeRate"), 1.0))
	credits := PeggedCreditsPerUnit(charge.AmountMinor, perMinor, rate)
	return credits, credits > 0
}
