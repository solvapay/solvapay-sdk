package solvapay

// BuildPaywallGate, ported from @solvapay/server's paywall-gate.ts (Python:
// paywall/gate.py). Turns a limits response into the paywall a customer
// sees: its kind, the machine-readable recovery fields, and the message. JSON
// in, JSON out, with the API's camelCase keys, so it can go straight into an
// MCP tool result's structuredContent.

import "math"

// allPaidPlansArePayg is true when every plan that takes payment is pay-as-you-go.
func allPaidPlansArePayg(plans any) bool {
	list, _ := plans.([]any)
	if len(list) == 0 {
		return false
	}
	paid := 0
	for _, p := range list {
		if get(p, "requiresPayment") == false {
			continue
		}
		paid++
		if kind := get(p, "type"); kind != "usage-based" && kind != "hybrid" {
			return false
		}
	}
	return paid > 0
}

func activePlan(limits map[string]any) any {
	ref := activePlanRef(limits)
	if isUndefined(ref) {
		return undefined
	}
	plans, _ := coalesce(get(limits, "plans"), []any{}).([]any)
	for _, plan := range plans {
		if jsStrictEqual(get(plan, "reference"), ref) {
			return plan
		}
	}
	return undefined
}

func includedUsage(limits map[string]any) map[string]any {
	used, limit, remaining := get(limits, "used"), get(limits, "limit"), get(limits, "remaining")
	if !isUndefined(used) && !isUndefined(limit) {
		out := jsObject{}
		out.set("total", limit)
		out.set("used", used)
		out.set("remaining", remaining)
		return out
	}
	total := get(activePlan(limits), "freeUnits")
	if n, ok := asNumber(total); nullish(total) || (ok && n == 0) {
		return nil
	}
	out := jsObject{}
	out.set("total", total)
	out.set("used", math.Max(0, number(total)-number(remaining)))
	out.set("remaining", remaining)
	return out
}

func gateLinks(limits map[string]any) map[string]any {
	links := map[string]any{}
	if checkoutURL := get(limits, "checkoutUrl"); truthy(checkoutURL) {
		if get(limits, "paywallReason") == "topup_required" {
			links["topup"] = checkoutURL
		} else {
			links["checkout"] = checkoutURL
		}
	}
	if confirmationURL := get(limits, "confirmationUrl"); truthy(confirmationURL) {
		links["manage"] = confirmationURL
	}
	if len(links) == 0 {
		return nil
	}
	return links
}

func recoveryFields(limits map[string]any, kind PaywallStateKind, fields jsObject) {
	plan := activePlan(limits)
	signals := readCreditSignals(limits)
	balance := get(limits, "balance")

	if ref := activePlanRef(limits); truthy(ref) {
		fields["planRef"] = ref
	}
	fields.set("planName", get(limits, "planName"))
	fields.set("plans", get(limits, "plans"))
	fields.set("meterName", get(limits, "meterName"))
	if unitPrice := get(plan, "perUnitChargeMinor"); !nullish(unitPrice) {
		fields["unitPriceMinor"] = unitPrice
		fields.set("currency", get(plan, "currency"))
	} else if currency := get(limits, "currency"); truthy(currency) {
		fields["currency"] = currency
	}
	if included := includedUsage(limits); included != nil {
		fields["included"] = included
	}
	fields.set("creditBalance", signals.creditBalance)
	fields["reason"] = string(kind)
	fields["nextAction"] = nextActionFor(kind)
	fields.set("creditsPerCall", signals.creditsPerCall)
	fields.set("shortfallCredits", signals.shortfallCredits)
	fields.set("remainingCalls", signals.remainingCalls)
	fields.set("creditsPerMinorUnit", get(balance, "creditsPerMinorUnit"))
	fields.set("displayExchangeRate", get(balance, "displayExchangeRate"))
	fields.set("purchaseRef", get(limits, "purchaseRef"))
	fields.set("autoRecharge", get(limits, "autoRecharge"))
	if links := gateLinks(limits); links != nil {
		fields["links"] = links
	}
}

// BuildPaywallGate is the paywall for a limits response: kind
// activation_required or payment_required, the recovery fields and the
// message. When the customer is out of credits and every paid plan is
// pay-as-you-go, the gate is activation_required with the plans attached, so
// clients show top-up copy; the message still names the top-up.
func BuildPaywallGate(productRef string, limits map[string]any) map[string]any {
	checkoutURL := get(limits, "checkoutUrl")
	kind := ClassifyPaywallState(limits)
	activation := truthy(get(limits, "activationRequired")) ||
		(kind == StateTopupRequired && allPaidPlansArePayg(get(limits, "plans")))

	gate := jsObject{"product": productRef}
	if activation {
		gate["kind"] = "activation_required"
		confirmationURL := get(limits, "confirmationUrl")
		switch {
		case truthy(confirmationURL):
			gate["checkoutUrl"] = confirmationURL
		case truthy(checkoutURL):
			gate["checkoutUrl"] = checkoutURL
		default:
			gate["checkoutUrl"] = ""
		}
		gate.set("confirmationUrl", confirmationURL)
	} else {
		gate["kind"] = "payment_required"
		if truthy(checkoutURL) {
			gate["checkoutUrl"] = checkoutURL
		} else {
			gate["checkoutUrl"] = ""
		}
	}
	gate.set("balance", get(limits, "balance"))
	gate.set("productDetails", get(limits, "product"))
	recoveryFields(limits, kind, gate)
	gate["message"] = BuildGateMessage(kind, gate)
	return gate
}
