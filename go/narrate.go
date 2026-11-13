package solvapay

// Narration for the built-in account and activate_plan tools, ported from
// @solvapay/mcp-core's narrate.ts (and narratedToolResult in helpers.ts).
//
// Each narrator renders the bootstrap payload as sparse markdown a text-only
// host can show as is: a bold title, "Label: value" rows, and the recovery
// as a named tool call. The copy matches the TypeScript SDK byte for byte;
// the conformance suite (conformance/cases/narration) checks it. A row whose
// value is missing is left out, never written as "Balance: —".
//
// The payload is loosely typed JSON, read with JavaScript's rules
// (narrate_jsvalue.go): a typed struct would lose the difference between a
// missing key and null, and reject the malformed fields TypeScript skips.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	viewerToolName       = "account"
	activatePlanToolName = "activate_plan"
	checkoutTTL          = "expires in 15 minutes"
	msPerDay             = 24 * 60 * 60 * 1000
)

// ToolMode is how an intent tool answers: ui, text or auto.
type ToolMode string

const (
	ToolModeAuto ToolMode = "auto"
	ToolModeUI   ToolMode = "ui"
	ToolModeText ToolMode = "text"
)

// ParseToolMode reads a tool's mode argument; anything else is auto.
func ParseToolMode(raw any) ToolMode {
	switch raw {
	case "ui", "text", "auto":
		return ToolMode(raw.(string))
	}
	return ToolModeAuto
}

// ResourceLink is a resource_link block that follows the narration.
type ResourceLink struct {
	URI  string `json:"uri"`
	Name string `json:"name"`
}

// NarratorOutput is a narrator's text and the links it names.
type NarratorOutput struct {
	Text  string
	Links []ResourceLink
}

// ContentBlock is one block of a tool result: type "text" with Text, or
// type "resource_link" with URI and Name.
type ContentBlock struct {
	Type string
	Text string
	URI  string
	Name string
}

// MarshalJSON writes the fields the block's type carries, as MCP does.
func (b ContentBlock) MarshalJSON() ([]byte, error) {
	if b.Type == "resource_link" {
		return json.Marshal(struct {
			Type string `json:"type"`
			URI  string `json:"uri"`
			Name string `json:"name"`
		}{b.Type, b.URI, b.Name})
	}
	return json.Marshal(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{b.Type, b.Text})
}

// NarratedResult is an intent tool's answer: the content blocks, and the
// payload as structured content (decoded JSON).
type NarratedResult struct {
	Content           []ContentBlock `json:"content"`
	StructuredContent any            `json:"structuredContent"`
}

var narrators = map[string]func(data any, now time.Time) NarratorOutput{
	"checkout":      narrateUpgrade,
	"account":       narrateManageAccount,
	"topup":         narrateTopup,
	"auto-recharge": narrateAutoRecharge,
}

// NarrateAccount answers the account tool for view as narratedToolResult
// does: the narration (led by a one-line placeholder in ui mode) and one
// resource_link per link. A view without a narrator answers with the payload
// as JSON text.
//
// payload is the bootstrap payload: decoded JSON (map[string]any), a
// json.RawMessage, or any value that marshals to it. The JSON fallback keeps
// a RawMessage's or a struct's key order; a Go map has none, so its keys
// come out sorted. now is the clock the account view measures days against.
func NarrateAccount(view string, payload any, mode ToolMode, now time.Time) (*NarratedResult, error) {
	raw, err := payloadJSON(payload)
	if err != nil {
		return nil, &Error{Code: "invalid_argument", Message: "NarrateAccount: the payload is not JSON: " + err.Error()}
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, &Error{Code: "invalid_argument", Message: "NarrateAccount: the payload is not JSON: " + err.Error()}
	}
	narrator, ok := narrators[view]
	if !ok {
		return &NarratedResult{Content: []ContentBlock{{Type: "text", Text: string(raw)}}, StructuredContent: data}, nil
	}
	output := narrator(data, now)
	var content []ContentBlock
	if mode == ToolModeUI {
		content = append(content, ContentBlock{Type: "text", Text: UIPlaceholder(view, data)})
	}
	content = append(content, ContentBlock{Type: "text", Text: output.Text})
	for _, link := range output.Links {
		content = append(content, ContentBlock{Type: "resource_link", URI: link.URI, Name: link.Name})
	}
	return &NarratedResult{Content: content, StructuredContent: data}, nil
}

// payloadJSON is JSON.stringify(payload): compact, without HTML escaping.
func payloadJSON(payload any) ([]byte, error) {
	var buf bytes.Buffer
	switch raw := payload.(type) {
	case json.RawMessage:
		if err := json.Compact(&buf, raw); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	case []byte:
		return payloadJSON(json.RawMessage(raw))
	}
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// ---- formatting -------------------------------------------------------------

var shortMonths = [...]string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// formatShortDate is toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).
func formatShortDate(iso any) string {
	if !jsTruthy(iso) {
		return ""
	}
	date, ok := parseJSDate(iso)
	if !ok {
		return ""
	}
	utc := date.UTC()
	return fmt.Sprintf("%s %d", shortMonths[utc.Month()-1], utc.Day())
}

func daysUntil(iso any, now time.Time) (int64, bool) {
	end, ok := parseJSDate(iso)
	if !ok {
		return 0, false
	}
	millis := end.UnixMilli() - now.Truncate(time.Millisecond).UnixMilli()
	days := int64(math.Ceil(float64(millis) / msPerDay))
	return max(0, days), true
}

func jsStrictEqual(a, b any) bool {
	if x, ok := jsNum(a); ok {
		y, ok := jsNum(b)
		return ok && x == y
	}
	switch x := a.(type) {
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case nil:
		return b == nil
	case jsUndefinedType:
		return b == jsUndefined
	}
	return false
}

func isOne(count any) bool { return jsStrictEqual(count, 1.0) }

func meterUnit(meter, count any) string {
	if jsTruthy(meter) && meter != "requests" {
		text := jsString(meter)
		if isOne(count) {
			return singular(text)
		}
		return text
	}
	if isOne(count) {
		return "call"
	}
	return "calls"
}

var (
	pluralIes = regexp.MustCompile(`(?i)[^aeiou]ies$`)
	pluralEs  = regexp.MustCompile(`(?i)(ch|sh|ss|x|z)es$`)
	pluralS   = regexp.MustCompile(`(?i)[^s]s$`)
)

// singular is one unit of a plural meter name: searches → search, queries → query.
func singular(word string) string {
	switch {
	case pluralIes.MatchString(word):
		return word[:len(word)-3] + "y"
	case pluralEs.MatchString(word):
		return word[:len(word)-2]
	case pluralS.MatchString(word):
		return word[:len(word)-1]
	}
	return word
}

func positive(v any) bool { return jsTruthy(v) && jsNumber(v) > 0 }

// orNull turns a reader's (value, ok) into a JavaScript value: the number or null.
func orNull(value float64, ok bool) any {
	if ok {
		return value
	}
	return nil
}

// ---- payload readers ----------------------------------------------------------

func narrateCustomer(data any) any { return jsCoalesce(jsGet(data, "customer"), nil) }

func narratePlans(data any) []map[string]any {
	var out []map[string]any
	if plans, ok := jsGet(data, "plans").([]any); ok {
		for _, plan := range plans {
			if m, ok := plan.(map[string]any); ok {
				out = append(out, m)
			}
		}
	}
	return out
}

func narrateActivePurchase(data any) map[string]any {
	purchases := jsGet(jsGet(narrateCustomer(data), "purchase"), "purchases")
	productRef, _ := jsGet(data, "productRef").(string)
	return SelectActivePlanPurchase(purchases, productRef)
}

// optional is a map that may be absent as an any: nil (null) for a nil map.
func optional(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

func creditsUnused(customer any) bool { return !limitsAreCreditBased(jsGet(customer, "limits")) }

func preferLimitsPlan(purchase map[string]any, limits any) bool {
	limitsRef := jsGet(limits, "planRef")
	if !jsTruthy(limitsRef) {
		return false
	}
	p := optional(purchase)
	return !jsStrictEqual(limitsRef, jsCoalesce(jsGet(p, "planRef"), jsGet(jsGet(p, "planSnapshot"), "reference")))
}

func productName(data any) string {
	if name, ok := jsGet(jsGet(data, "product"), "name").(string); ok && name != "" {
		return name
	}
	return "SolvaPay"
}

// balanceSummary is the balance row without its label, for the ui placeholder.
func balanceSummary(customer any) string {
	row := balanceRow(customer)
	return strings.TrimLeft(strings.TrimPrefix(row, "Balance:"), " \t\n\r\f\v")
}

func identityRow(customer any) string {
	ref, _ := jsGet(customer, "ref").(string)
	ref = jsTrim(ref)
	if ref == "" {
		return ""
	}
	email, _ := jsGet(customer, "email").(string)
	if email = jsTrim(email); email != "" {
		return "Signed in as: " + email + " · " + ref
	}
	return "Signed in as: " + ref
}

func balanceRow(customer any) string {
	balance := jsGet(customer, "balance")
	if !jsTruthy(balance) {
		return ""
	}
	credits := jsCoalesce(jsGet(balance, "credits"), 0.0)
	if !jsTruthy(credits) && !jsStrictEqual(credits, 0.0) {
		return ""
	}
	currency := jsGet(balance, "displayCurrency")
	var displayMinor any
	if perMinor, ok := jsNum(jsGet(balance, "creditsPerMinorUnit")); jsTruthy(currency) && ok && perMinor > 0 {
		rate := jsNumber(jsCoalesce(jsGet(balance, "displayExchangeRate"), 1.0))
		displayMinor = orNull(CreditsToDisplayMinorUnits(jsNumber(credits), perMinor, rate, jsString(currency)))
	}
	money := formatMoney(displayMinor, jsCoalesce(currency, nil))
	count := formatCount(credits)
	if money != "" {
		return "Balance: " + count + " credits (~" + money + ")"
	}
	return "Balance: " + count + " credits"
}

func recoveryLine(views ...string) string {
	calls := make([]string, len(views))
	for i, view := range views {
		calls[i] = fmt.Sprintf("`%s` with view: %q", viewerToolName, view)
	}
	return "To continue, call " + strings.Join(calls, " or ") + "."
}

// ---- plans ----------------------------------------------------------------------

func formatPlanPrices(plan any) string {
	shape := PlanPricingShape(plan)
	if headline := HeadlineCharges(plan); len(headline) > 0 {
		var prices []string
		for _, charge := range headline {
			if money := formatMoney(charge.AmountMinor, charge.Currency); money != "" {
				prices = append(prices, money)
			}
		}
		return strings.Join(prices, " · ")
	}
	rate := shape.Rate
	if rate == nil {
		rate = PlanUsageRate(plan, "")
	}
	if rate != nil && rate.AmountMinor > 0 {
		if money := formatMoney(rate.AmountMinor, rate.Currency); money != "" {
			unit := firstNonEmpty(rate.Meter, MeterName(plan), "unit")
			floor := ""
			if rate.Tiered {
				floor = "from "
			}
			return floor + money + " / " + unit
		}
	}
	return formatMoney(jsGet(plan, "price"), jsGet(plan, "currency"))
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func isFreePlan(plan any) bool { return jsGet(plan, "requiresPayment") == false }

func planTypeLabel(plan any) string {
	if isFreePlan(plan) {
		return "no payment required"
	}
	switch PlanPricingShape(plan).Shape {
	case "usage":
		return "pay as you go"
	case "hybrid":
		return "subscription + usage"
	case "oneTime":
		return "one-time"
	}
	return "recurring"
}

func formatCycle(plan any) string {
	cycle := PlanPricingShape(plan).Cycle
	if cycle == nil {
		cycle = PlanBillingCycle(plan)
	}
	if cycle == nil {
		return ""
	}
	if cycle.Count != 0 {
		return "/" + jsNumberString(cycle.Count) + " " + cycle.Interval + "s"
	}
	return "/" + cycle.Interval
}

func plansListLines(plans []map[string]any) []string {
	lines := make([]string, 0, len(plans))
	for _, plan := range plans {
		parts := []string{jsString(jsCoalesce(jsGet(plan, "name"), "Plan")), planTypeLabel(plan)}
		if price := formatPlanPrices(plan); price != "" && !isFreePlan(plan) {
			parts = append(parts, price+formatCycle(plan))
		}
		if trial, ok := TrialDays(plan); ok {
			parts = append(parts, jsNumberString(trial)+"-day trial")
		}
		if ref := jsGet(plan, "reference"); jsTruthy(ref) {
			parts = append(parts, "planRef: "+jsString(ref))
		}
		lines = append(lines, strings.Join(parts, " · "))
	}
	return lines
}

// ---- links --------------------------------------------------------------------

var httpURL = regexp.MustCompile(`(?i)^https?://`)

func httpsURL(value any) string {
	if text, ok := value.(string); ok && httpURL.MatchString(text) {
		return text
	}
	return ""
}

func checkoutURLOf(data any) string { return httpsURL(jsGet(data, "checkoutUrl")) }

func checkoutLinkLabel(url string) string {
	if strings.Contains(url, "/checkout/topup") {
		return "Add credits"
	}
	return "Open checkout"
}

func namedCheckoutMarkdown(url string) string {
	return "[" + checkoutLinkLabel(url) + "](" + url + ")"
}

func checkoutRow(data any) string {
	if url := checkoutURLOf(data); url != "" {
		return "Checkout: " + namedCheckoutMarkdown(url) + " (" + checkoutTTL + ")"
	}
	return ""
}

func namedManageMarkdown(url string) string { return "[Manage account](" + url + ")" }

func manageRow(data any) string {
	if url := httpsURL(jsGet(data, "portalUrl")); url != "" {
		return "Manage: " + namedManageMarkdown(url) + " (" + checkoutTTL + ")"
	}
	return ""
}

// ---- account state --------------------------------------------------------------

func isPaidPlan(plan any) bool {
	if jsGet(plan, "requiresPayment") == false {
		return false
	}
	for _, charge := range Charges(plan) {
		if charge.AmountMinor > 0 {
			return true
		}
	}
	// A plan priced only in tier bands has no flat or per-unit charge.
	for _, meter := range TierMeters(plan) {
		for _, tier := range TierBands(plan, meter) {
			if tier.Charge.AmountMinor > 0 {
				return true
			}
		}
	}
	return jsNumber(jsCoalesce(jsGet(plan, "price"), 0.0)) > 0
}

func hasReadableOptions(plan any) bool {
	options, ok := jsGet(plan, "options").([]any)
	return ok && len(options) > 0
}

// narratorPlanShape is free, trial, usage-based, recurring-unlimited,
// recurring-metered or paid-unknown; "" without a plan.
func narratorPlanShape(plan any) string {
	if !jsTruthy(plan) {
		return ""
	}
	if trial, ok := TrialDays(plan); ok && trial > 0 {
		return "trial"
	}
	if !isPaidPlan(plan) {
		return "free"
	}
	metered := CountsUsage(plan)
	cap, hasCap := IncludedUnits(plan, "")
	unlimitedCap := hasCap && cap == 0
	readable := hasReadableOptions(plan)
	if PlanBillingCycle(plan) != nil {
		switch {
		case metered && !unlimitedCap:
			return "recurring-metered"
		case unlimitedCap || (readable && !metered):
			return "recurring-unlimited"
		}
		return "paid-unknown"
	}
	switch {
	case metered && !unlimitedCap:
		return "usage-based"
	case unlimitedCap || (readable && !metered):
		return "recurring-unlimited"
	}
	return "paid-unknown"
}

func mergePlan(snapshot, catalog any) any {
	if !jsTruthy(snapshot) && !jsTruthy(catalog) {
		return nil
	}
	snap, _ := snapshot.(map[string]any)
	cat, _ := catalog.(map[string]any)
	if !jsTruthy(catalog) {
		return snapshot
	}
	if !jsTruthy(snapshot) {
		return catalog
	}
	merged := map[string]any{}
	for k, v := range cat {
		merged[k] = v
	}
	for k, v := range snap {
		merged[k] = v
	}
	if options, ok := jsGet(snap, "options").([]any); ok && len(options) > 0 {
		merged["options"] = options
	} else if options := jsGet(cat, "options"); options != jsUndefined {
		merged["options"] = options
	} else {
		delete(merged, "options")
	}
	if requires := jsCoalesce(jsGet(snap, "requiresPayment"), jsGet(cat, "requiresPayment")); requires != jsUndefined {
		merged["requiresPayment"] = requires
	} else {
		delete(merged, "requiresPayment")
	}
	if metered := jsGet(snap, "isMetered"); metered != jsUndefined {
		merged["isMetered"] = metered
	} else {
		delete(merged, "isMetered")
	}
	return merged
}

func findCatalogPlan(plans []map[string]any, snapshot, planRef any) map[string]any {
	ref := jsCoalesce(jsGet(snapshot, "reference"), planRef)
	if !jsTruthy(ref) {
		return nil
	}
	for _, plan := range plans {
		if jsStrictEqual(jsGet(plan, "reference"), ref) {
			return plan
		}
	}
	return nil
}

func isAtFiniteCap(limits any) bool {
	if !jsTruthy(limits) || jsGet(limits, "withinLimits") != false {
		return false
	}
	remaining := jsGet(limits, "remaining")
	if jsNullish(remaining) || jsStrictEqual(remaining, -1.0) {
		return false
	}
	return jsNumber(remaining) <= 0
}

func isCancelledNotExpired(purchase any, now time.Time) bool {
	if !jsTruthy(jsGet(purchase, "cancelledAt")) || !jsTruthy(jsGet(purchase, "endDate")) {
		return false
	}
	end, ok := parseJSDate(jsGet(purchase, "endDate"))
	return ok && end.After(now)
}

func accountState(purchase map[string]any, limits, plan any, now time.Time) string {
	if jsTruthy(jsGet(limits, "activationRequired")) {
		return "H"
	}
	if isCancelledNotExpired(optional(purchase), now) {
		return "J"
	}
	if jsTruthy(jsGet(limits, "overage")) {
		return "I"
	}
	if jsTruthy(jsGet(limits, "needsTopUp")) {
		return "D"
	}
	shape := narratorPlanShape(plan)
	if purchase == nil && shape == "" {
		return "A"
	}
	atCap := isAtFiniteCap(limits)
	switch {
	case shape == "usage-based":
		if atCap || jsGet(limits, "withinLimits") == false {
			return "D"
		}
		return "B"
	case atCap:
		return "F"
	case shape == "free" || shape == "trial":
		return "E"
	case shape == "recurring-metered" || shape == "recurring-unlimited":
		return "C"
	case purchase != nil:
		return "C"
	}
	return "A"
}

// cadencePhrase is how often a plan bills, for a sentence with no price: every year, every 3 months.
func cadencePhrase(plan any) string {
	cycle := PlanBillingCycle(plan)
	if cycle == nil {
		return ""
	}
	if cycle.Count == 0 || cycle.Count == 1 {
		return "every " + cycle.Interval
	}
	return "every " + jsNumberString(cycle.Count) + " " + cycle.Interval + "s"
}

func intervalPhrase(plan any) string {
	cycle := PlanBillingCycle(plan)
	if cycle == nil {
		return ""
	}
	if cycle.Count == 0 || cycle.Count == 1 {
		return "a " + cycle.Interval
	}
	return "every " + jsNumberString(cycle.Count) + " " + cycle.Interval + "s"
}

func planPricePhrase(plan any) string {
	if headline := HeadlineCharges(plan); len(headline) > 0 {
		var present []string
		for _, charge := range headline {
			if money := formatCompactMoney(charge.AmountMinor, charge.Currency); money != "" {
				present = append(present, money)
			}
		}
		if len(present) > 0 {
			return strings.Join(present, " · ")
		}
	}
	return formatCompactMoney(jsGet(plan, "price"), jsGet(plan, "currency"))
}

func planPriceBit(plan any) string {
	price := planPricePhrase(plan)
	cycle := intervalPhrase(plan)
	switch {
	case PlanBillingCycle(plan) == nil:
		if price != "" {
			return ", " + price + " once"
		}
		return ""
	case price != "" && cycle != "":
		return ", " + price + " " + cycle
	case price != "":
		return ", " + price
	}
	return ""
}

func creditsRatePhrase(plan, customer any) string {
	rate := PlanUsageRate(plan, "")
	if rate == nil || rate.AmountMinor <= 0 {
		return ""
	}
	floor := ""
	if rate.Tiered {
		floor = "from "
	}
	credits, ok := CreditsPerUnitFromBalance(plan, jsGet(customer, "balance"), "")
	if !ok {
		money := formatCompactMoney(rate.AmountMinor, rate.Currency)
		if money == "" {
			return ""
		}
		return floor + money + " per " + meterUnit(firstNonEmpty(rate.Meter, MeterName(plan)), 1.0)
	}
	return floor + formatCount(credits) + " credits per call"
}

func catalogFragment(plan map[string]any, customer any) string {
	name := jsString(jsCoalesce(jsGet(plan, "name"), "Plan"))
	capValue, hasCap := IncludedUnits(plan, "")
	cap := orNull(capValue, hasCap)
	cycle := intervalPhrase(plan)
	price := planPricePhrase(plan)
	rate := creditsRatePhrase(plan, customer)
	shape := narratorPlanShape(plan)
	cycleBit := ""
	if cycle != "" {
		cycleBit = " " + cycle
	}
	unitsOf := func() string { return formatCount(cap) + " " + meterUnit(MeterName(plan), cap) }

	var core string
	switch {
	case shape == "free" || (!isPaidPlan(plan) && shape != "trial"):
		if positive(cap) {
			core = name + " gives " + unitsOf() + cycleBit
		} else {
			core = name + " requires no payment"
		}
	case shape == "usage-based":
		if rate != "" {
			core = name + " is " + rate
		} else {
			core = name + " is pay as you go"
		}
	case PlanBillingCycle(plan) == nil:
		allowance := " for unlimited"
		if hasCap && capValue != 0 {
			allowance = " for " + unitsOf()
		}
		if price != "" {
			core = name + " is " + price + " once" + allowance
		} else {
			core = name + " is one-time"
		}
	default:
		allowance := ""
		if hasCap && capValue == 0 {
			allowance = " for unlimited"
		} else if positive(cap) {
			allowance = " for " + unitsOf()
		}
		switch {
		case price != "":
			core = name + " is " + price + cycleBit + allowance
		case cycle != "":
			core = name + " is billed " + firstNonEmpty(cadencePhrase(plan), cycle) + allowance
		default:
			core = name
		}
	}
	if trial, ok := TrialDays(plan); ok {
		core += " · " + jsNumberString(trial) + "-day trial"
	}
	if ref := jsGet(plan, "reference"); jsTruthy(ref) {
		core += " · planRef: " + jsString(ref)
	}
	return core
}

func carryOnFragment(plan map[string]any, customer any) string {
	name := jsString(jsCoalesce(jsGet(plan, "name"), "Plan"))
	var core string
	if narratorPlanShape(plan) == "usage-based" {
		credits := jsGet(jsGet(customer, "balance"), "credits")
		if positive(credits) {
			core = name + " starts now using your existing " + formatCount(credits) + " credits"
		} else {
			core = name + " starts now"
		}
	} else {
		price := planPricePhrase(plan)
		cycle := intervalPhrase(plan)
		switch {
		case PlanBillingCycle(plan) == nil && price != "":
			core = name + " is " + price + " once"
		case PlanBillingCycle(plan) != nil && price != "" && cycle != "":
			core = name + " is " + price + " " + cycle
		default:
			core = name
		}
	}
	if ref := jsGet(plan, "reference"); jsTruthy(ref) {
		return core + " · planRef: " + jsString(ref)
	}
	return core
}

func joinOr(parts []string) string {
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	case 2:
		return parts[0] + ", or " + parts[1]
	}
	return strings.Join(parts[:len(parts)-1], ", ") + ", or " + parts[len(parts)-1]
}

func remainingOfTotal(usage any) string {
	remaining, total := jsGet(usage, "remaining"), jsGet(usage, "total")
	if jsNullish(remaining) || jsNullish(total) || jsNumber(remaining) < 0 {
		return ""
	}
	return formatCount(remaining) + " of " + formatCount(total) + " " + meterUnit(jsGet(usage, "meterRef"), total)
}

func usedOfTotal(usage any) string {
	used, total := jsGet(usage, "used"), jsGet(usage, "total")
	if jsNullish(used) || jsNullish(total) {
		return ""
	}
	return formatCount(used) + " of " + formatCount(total) + " " + meterUnit(jsGet(usage, "meterRef"), total)
}

func claimableFreePlan(plans []map[string]any) map[string]any {
	for _, plan := range plans {
		if jsGet(plan, "requiresPayment") != false {
			continue
		}
		if cap, ok := IncludedUnits(plan, ""); ok && cap > 0 {
			return plan
		}
	}
	return nil
}

func recoveryForState(state string, freePlanRef any) string {
	switch state {
	case "B":
		return recoveryLine("topup")
	case "D":
		return recoveryLine("topup", "checkout")
	case "H":
		if jsTruthy(freePlanRef) {
			return fmt.Sprintf("To continue, call `%s` with planRef: \"%s\".", activatePlanToolName, jsString(freePlanRef))
		}
		return recoveryLine("checkout")
	case "J":
		return recoveryLine("account")
	}
	return recoveryLine("checkout")
}

func accountBody(state, product string, plan any, planShape string, purchase map[string]any, customer any, plans []map[string]any, now time.Time) string {
	planName := jsString(jsCoalesce(jsGet(plan, "name"), "plan"))
	usage := jsCoalesce(jsGet(customer, "usage"), nil)
	credits := jsCoalesce(jsGet(jsGet(customer, "balance"), "credits"), 0.0)
	view := "Call `" + viewerToolName + "` with view:"
	p := optional(purchase)

	switch state {
	case "A":
		fragments := make([]string, len(plans))
		for i, item := range plans {
			fragments[i] = catalogFragment(item, customer)
		}
		catalog := ""
		if len(fragments) > 0 {
			catalog = " " + strings.Join(fragments, ", ") + "."
		}
		return product + " has no plan yet." + catalog + " Reply with a plan name to activate it."

	case "H":
		free := claimableFreePlan(plans)
		var cap any
		if free != nil {
			cap = orNull(IncludedUnits(free, ""))
		}
		cycle := intervalPhrase(optional(free))
		unitCount := any(2.0)
		if positive(cap) {
			unitCount = cap
		}
		unit := meterUnit(MeterName(optional(free)), unitCount)
		ready := "no card"
		if positive(cap) {
			ready = formatCount(cap) + " " + unit
			if cycle != "" {
				ready += " " + cycle
			}
			ready += ", no card"
		}
		return product + " has a free plan ready: " + ready + ". Call `" + activatePlanToolName + "` with a `planRef` to activate it."

	case "B":
		rate := creditsRatePhrase(plan, customer)
		var perCall any
		if jsTruthy(plan) {
			perCall = orNull(CreditsPerUnitFromBalance(plan, jsGet(customer, "balance"), ""))
		}
		runway := ""
		if positive(perCall) {
			runway = ", about " + formatCount(math.Floor(jsNumber(credits)/jsNumber(perCall))) + " calls"
		}
		rateBit := ""
		if rate != "" {
			rateBit = ", " + rate
		}
		return product + " is on " + planName + rateBit + ". Balance " + formatCount(credits) + " credits" + runway + ". " + view + " 'topup' to add credits."

	case "D":
		var perCall any
		if jsTruthy(plan) {
			perCall = orNull(CreditsPerUnitFromBalance(plan, jsGet(customer, "balance"), ""))
		}
		costBit := " and " + planName + " needs credits"
		if positive(perCall) {
			shortfall := math.Max(0, jsNumber(perCall)-jsNumber(credits))
			costBit = "; this call costs " + formatCount(perCall) + " credits — " + formatCount(shortfall) + " short"
		}
		return product + " is on " + planName + ". Balance " + formatCount(credits) + " credits" + costBit + ". " +
			view + " 'topup' to add credits, or with view: 'checkout' to switch to a plan that does not use credits."

	case "C":
		priceBit := planPriceBit(plan)
		oneTime := PlanBillingCycle(plan) == nil
		left := remainingOfTotal(usage)
		date := formatShortDate(jsCoalesce(jsGet(usage, "periodEnd"), jsGet(p, "endDate")))
		renewing := ""
		if date != "" {
			renewing = ", renewing " + date
		}
		cap, hasCap := IncludedUnits(plan, "")
		unlimited := jsStrictEqual(jsGet(usage, "remaining"), -1.0) || (hasCap && cap == 0) || planShape == "recurring-unlimited"
		var position string
		switch {
		case left != "" && oneTime:
			position = left + " left"
		case left != "":
			position = left + " left this period" + renewing
		case unlimited && oneTime:
			position = "Unlimited calls"
		case unlimited:
			position = "Unlimited calls" + renewing
		case date != "" && !oneTime:
			position = "Renews " + date
		default:
			position = "After your first call"
		}
		tail := view + " 'checkout' to switch."
		if creditsUnused(customer) {
			tail = "Credits are not used on this plan. " + tail
		}
		return product + " is on " + planName + priceBit + ". " + position + ". " + tail

	case "E":
		left := remainingOfTotal(usage)
		date := formatShortDate(jsGet(usage, "periodEnd"))
		interval := "period"
		if cycle := PlanBillingCycle(plan); cycle != nil {
			interval = cycle.Interval
		}
		var leftBit string
		switch {
		case left != "":
			leftBit = left + " left this " + interval
			if date != "" {
				leftBit += ", resetting " + date
			}
		case date != "":
			leftBit = "resets " + date
		default:
			leftBit = "After your first call"
		}
		return product + " is on the free plan: " + leftBit + ". Credits are not used on " + planName + ". " + view + " 'checkout' for more calls."

	case "F":
		cap := jsCoalesce(jsGet(usage, "total"), orNull(IncludedUnits(plan, "")))
		unitCount := any(2.0)
		if positive(cap) {
			unitCount = cap
		}
		unit := meterUnit(jsCoalesce(jsGet(usage, "meterRef"), emptyAsNull(MeterName(plan))), unitCount)
		date := formatShortDate(jsGet(usage, "periodEnd"))
		capBit := "allowance is used up"
		if positive(cap) {
			capBit = formatCount(cap) + " " + unit + " are used up"
		}
		consequence := " Further calls fail until the allowance resets"
		if date != "" {
			consequence = " Further calls fail until " + date
		}
		current := jsCoalesce(jsGet(plan, "reference"), jsGet(p, "planRef"))
		var others []string
		for _, item := range plans {
			ref := jsGet(item, "reference")
			if jsTruthy(ref) && jsStrictEqual(ref, current) {
				continue
			}
			if shape := narratorPlanShape(item); shape == "free" || shape == "trial" {
				continue
			}
			others = append(others, carryOnFragment(item, customer))
		}
		carryOn := ""
		if len(others) > 0 {
			carryOn = " " + joinOr(others) + "."
		}
		antiTrap := ""
		if creditsUnused(customer) {
			antiTrap = " Adding credits will not help, because " + planName + " does not spend them."
		}
		return product + " is on " + planName + planPriceBit(plan) + ". " + capBit + "." + consequence + "." + antiTrap +
			carryOn + " " + view + " 'checkout' to switch plan."

	case "I":
		usedBit := ""
		if used := usedOfTotal(usage); used != "" {
			usedBit = ": " + used + " used"
		}
		return product + " is over its " + planName + " allowance" + usedBit + ". Calls still work, paid from your credits. " +
			view + " 'checkout' for a higher limit."
	}

	endDate := jsGet(p, "endDate")
	until := "is cancelled"
	if date := formatShortDate(endDate); date != "" {
		until = "runs until " + date
	}
	daysBit := ""
	if jsTruthy(endDate) {
		if days, ok := daysUntil(endDate, now); ok {
			daysBit = ", " + strconv.FormatInt(days, 10) + " days away"
		}
	}
	leftBit := ""
	if left := remainingOfTotal(usage); left != "" {
		leftBit = ", with " + left + " left"
	}
	return product + "'s " + planName + " plan is cancelled and " + until + daysBit + leftBit + ". " +
		"Calls stop after that. " + view + " 'account' to reactivate it."
}

func emptyAsNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---- narrators ------------------------------------------------------------------

// ActivationResult is what activating a plan answered, for NarrateActivatePlan.
// Status is activated, already_active, already_purchased, topup_required,
// payment_required or invalid.
type ActivationResult struct {
	Status         string   `json:"status"`
	PlanName       string   `json:"planName,omitempty"`
	CheckoutURL    string   `json:"checkoutUrl,omitempty"`
	Message        *string  `json:"message,omitempty"`
	CreditBalance  *float64 `json:"creditBalance,omitempty"`
	CreditsPerUnit *float64 `json:"creditsPerUnit,omitempty"`
}

// NarrateActivatePlan is the text activate_plan answers with, for one
// activation result. An unknown status is an invalid_argument error.
func NarrateActivatePlan(result ActivationResult) (string, error) {
	named := "This plan"
	if result.PlanName != "" {
		named = result.PlanName
	}
	checkout := ""
	if url := result.CheckoutURL; url != "" {
		checkout = " [" + checkoutLinkLabel(url) + "](" + url + ") (" + checkoutTTL + "), or"
	}
	view := "`" + viewerToolName + "` with view:"
	switch result.Status {
	case "activated":
		if result.PlanName != "" {
			return "Activated " + result.PlanName + ". Paid tools are available now.", nil
		}
		return "Plan activated. Paid tools are available now.", nil
	case "already_purchased":
		return named + " is already purchased. Call " + view + " 'account' to manage it.", nil
	case "payment_required":
		return named + " requires payment." + checkout + " Call " + view + " 'checkout' to pay.", nil
	case "topup_required":
		return named + " needs credits before it can activate." + checkout + " Call " + view + " 'topup' to add credits.", nil
	case "invalid":
		if result.Message != nil {
			return *result.Message, nil
		}
		return "That planRef is not valid for this product. Call " + view + " 'checkout' to see plans.", nil
	case "already_active":
		if result.CreditBalance != nil && result.CreditsPerUnit != nil {
			balance, cost := *result.CreditBalance, *result.CreditsPerUnit
			if shortfall := math.Max(0, cost-balance); shortfall > 0 {
				return named + " is already active. Balance " + formatCount(balance) + " credits; " +
					"this call costs " + formatCount(cost) + " credits — " + formatCount(shortfall) + " short. " +
					"Call the `" + viewerToolName + "` tool with view: 'topup' to add credits.", nil
			}
		}
		return named + " is already active.", nil
	}
	return "", &Error{Code: "invalid_argument", Message: fmt.Sprintf("Unknown activation status: %q", result.Status)}
}

func appendIf(lines []string, line string) []string {
	if line != "" {
		return append(lines, line)
	}
	return lines
}

func checkoutLinks(data any) []ResourceLink {
	if url := checkoutURLOf(data); url != "" {
		return []ResourceLink{{URI: url, Name: checkoutLinkLabel(url)}}
	}
	return nil
}

// narrateManageAccount is the account view: where the customer stands and what to do next.
func narrateManageAccount(data any, now time.Time) NarratorOutput {
	customer := narrateCustomer(data)
	plans := narratePlans(data)
	active := narrateActivePurchase(data)
	limits := jsGet(customer, "limits")
	var plan any
	if preferLimitsPlan(active, limits) {
		limitsRef := jsGet(limits, "planRef")
		if catalog := findCatalogPlan(plans, map[string]any{"reference": limitsRef}, limitsRef); catalog != nil {
			plan = catalog
		} else {
			fallback := map[string]any{}
			if name := jsGet(limits, "planName"); !jsNullish(name) {
				fallback["name"] = name
			}
			fallback["reference"] = limitsRef
			plan = fallback
		}
	} else {
		snapshot := jsGet(optional(active), "planSnapshot")
		catalog := findCatalogPlan(plans, snapshot, jsGet(optional(active), "planRef"))
		plan = mergePlan(snapshot, optional(catalog))
	}
	planShape := narratorPlanShape(plan)
	state := accountState(active, limits, plan, now)
	name := productName(data)
	free := claimableFreePlan(plans)

	title := "**" + name + " — your account**"
	if state == "A" || state == "H" {
		title = "**Welcome to " + name + "**"
	}
	lines := []string{title, "", accountBody(state, name, plan, planShape, active, customer, plans, now)}
	lines = appendIf(lines, identityRow(customer))
	if state == "A" || state == "H" {
		lines = appendIf(lines, balanceRow(customer))
	}
	lines = appendIf(lines, manageRow(data))
	lines = appendIf(lines, checkoutRow(data))
	lines = append(lines, "", recoveryForState(state, jsGet(optional(free), "reference")))

	var links []ResourceLink
	if url := httpsURL(jsGet(data, "portalUrl")); url != "" {
		links = append(links, ResourceLink{URI: url, Name: "Manage account"})
	}
	links = append(links, checkoutLinks(data)...)
	return NarratorOutput{Text: strings.Join(lines, "\n"), Links: links}
}

func withCheckout(data any, lines []string) NarratorOutput {
	lines = appendIf(lines, checkoutRow(data))
	return NarratorOutput{Text: strings.Join(lines, "\n"), Links: checkoutLinks(data)}
}

// narrateUpgrade is the checkout view: the plans on offer.
func narrateUpgrade(data any, _ time.Time) NarratorOutput {
	lines := []string{"**Upgrade — " + productName(data) + "**", ""}
	hasActive := narrateActivePurchase(data) != nil
	var plans []map[string]any
	for _, plan := range narratePlans(data) {
		if !hasActive || !isFreePlan(plan) {
			plans = append(plans, plan)
		}
	}
	if len(plans) > 0 {
		lines = append(lines, "Plans available:")
		lines = append(lines, plansListLines(plans)...)
	} else {
		lines = append(lines, "No paid plans are configured on this product yet.")
	}
	lines = append(lines, "", recoveryLine("account"))
	return withCheckout(data, lines)
}

// narrateTopup is the topup view: the balance and where to add credits.
func narrateTopup(data any, _ time.Time) NarratorOutput {
	lines := []string{"**Top up — " + productName(data) + "**", ""}
	lines = appendIf(lines, balanceRow(narrateCustomer(data)))
	lines = append(lines, "", recoveryLine("account"))
	return withCheckout(data, lines)
}

// narrateAutoRecharge is the auto-recharge view: whether it is on, and the portal link to change it.
func narrateAutoRecharge(data any, _ time.Time) NarratorOutput {
	lines := []string{"**Auto-recharge — " + productName(data) + "**", ""}
	customer := narrateCustomer(data)
	lines = appendIf(lines, balanceRow(customer))
	auto := jsGet(customer, "autoRecharge")
	enabled := jsGet(auto, "enabled") == true
	switch {
	case jsGet(auto, "status") == "failed":
		lines = append(lines, "Auto-recharge failed — update your card to resume")
	case enabled:
		lines = append(lines, "Auto-recharge is on. It tops your balance up automatically so calls do not fail.")
	default:
		lines = append(lines, "Auto-recharge is off. Turn it on from the link below — it stores a card and tops your balance up automatically so calls do not fail.")
	}
	manageURL := firstNonEmpty(httpsURL(jsGet(data, "autoRechargeUrl")), httpsURL(jsGet(data, "portalUrl")))
	if manageURL != "" {
		lines = append(lines, "Manage: "+namedManageMarkdown(manageURL)+" ("+checkoutTTL+")")
	}
	lines = append(lines, "", recoveryLine("account"))
	var links []ResourceLink
	if manageURL != "" {
		name := "Turn on auto-recharge"
		if enabled {
			name = "Manage auto-recharge"
		}
		links = append(links, ResourceLink{URI: manageURL, Name: name})
	}
	return NarratorOutput{Text: strings.Join(lines, "\n"), Links: links}
}

var uiOpened = map[string]string{
	"topup":         "Opened %s top-up.",
	"checkout":      "Opened %s upgrade.",
	"account":       "Opened your %s account.",
	"auto-recharge": "Opened %s auto-recharge.",
}

func placeholderPlan(view string, data any) any {
	if view == "account" {
		snapshot := jsGet(optional(narrateActivePurchase(data)), "planSnapshot")
		if !jsTruthy(snapshot) {
			return nil
		}
		plan := map[string]any{}
		for _, key := range []string{"name", "price", "currency", "options", "reference"} {
			if value := jsGet(snapshot, key); value != jsUndefined {
				plan[key] = value
			}
		}
		return plan
	}
	plans := narratePlans(data)
	for _, plan := range plans {
		if !isFreePlan(plan) {
			return plan
		}
	}
	if len(plans) > 0 {
		return plans[0]
	}
	return nil
}

// UIPlaceholder is the one line ui mode leads with, still self-sufficient
// on a text-only host. view must be one of the narrated views.
func UIPlaceholder(view string, data any) string {
	name := productName(data)
	parts := []string{fmt.Sprintf(uiOpened[view], name)}
	if plan := placeholderPlan(view, data); plan != nil {
		var label []string
		if planName := jsString(jsCoalesce(jsGet(plan, "name"), "Plan")); planName != "" {
			label = append(label, planName)
		}
		if price := formatPlanPrices(plan); price != "" && !isFreePlan(plan) {
			label = append(label, price)
		}
		if len(label) > 0 {
			parts = append(parts, strings.Join(label, " · ")+".")
		}
	}
	if balance := balanceSummary(narrateCustomer(data)); balance != "" {
		parts = append(parts, "Balance: "+balance+".")
	}
	if url := checkoutURLOf(data); url != "" {
		parts = append(parts, "Checkout: "+namedCheckoutMarkdown(url)+" ("+checkoutTTL+").")
	}
	return strings.Join(parts, " ")
}
