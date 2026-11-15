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
		if jsGet(p, "requiresPayment") == false {
			continue
		}
		paid++
		if kind := jsGet(p, "type"); kind != "usage-based" && kind != "hybrid" {
			return false
		}
	}
	return paid > 0
}

func activePlan(limits map[string]any) any {
	ref := activePlanRef(limits)
	if ref == jsUndefined {
		return jsUndefined
	}
	plans, _ := jsCoalesce(jsGet(limits, "plans"), []any{}).([]any)
	for _, plan := range plans {
		if jsStrictEqual(jsGet(plan, "reference"), ref) {
			return plan
		}
	}
	return jsUndefined
}

func includedUsage(limits map[string]any) map[string]any {
	used, limit, remaining := jsGet(limits, "used"), jsGet(limits, "limit"), jsGet(limits, "remaining")
	if used != jsUndefined && limit != jsUndefined {
		out := jsObject{}
		out.set("total", limit)
		out.set("used", used)
		out.set("remaining", remaining)
		return out
	}
	total := jsGet(activePlan(limits), "freeUnits")
	if n, ok := jsNum(total); jsNullish(total) || (ok && n == 0) {
		return nil
	}
	out := jsObject{}
	out.set("total", total)
	out.set("used", math.Max(0, jsNumber(total)-jsNumber(remaining)))
	out.set("remaining", remaining)
	return out
}

func gateLinks(limits map[string]any) map[string]any {
	links := map[string]any{}
	if checkoutURL := jsGet(limits, "checkoutUrl"); jsTruthy(checkoutURL) {
		if jsGet(limits, "paywallReason") == "topup_required" {
			links["topup"] = checkoutURL
		} else {
			links["checkout"] = checkoutURL
		}
	}
	if confirmationURL := jsGet(limits, "confirmationUrl"); jsTruthy(confirmationURL) {
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
	balance := jsGet(limits, "balance")

	if ref := activePlanRef(limits); jsTruthy(ref) {
		fields["planRef"] = ref
	}
	fields.set("planName", jsGet(limits, "planName"))
	fields.set("plans", jsGet(limits, "plans"))
	fields.set("meterName", jsGet(limits, "meterName"))
	if unitPrice := jsGet(plan, "perUnitChargeMinor"); !jsNullish(unitPrice) {
		fields["unitPriceMinor"] = unitPrice
		fields.set("currency", jsGet(plan, "currency"))
	} else if currency := jsGet(limits, "currency"); jsTruthy(currency) {
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
	fields.set("creditsPerMinorUnit", jsGet(balance, "creditsPerMinorUnit"))
	fields.set("displayExchangeRate", jsGet(balance, "displayExchangeRate"))
	fields.set("purchaseRef", jsGet(limits, "purchaseRef"))
	fields.set("autoRecharge", jsGet(limits, "autoRecharge"))
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
	checkoutURL := jsGet(limits, "checkoutUrl")
	kind := ClassifyPaywallState(limits)
	activation := jsTruthy(jsGet(limits, "activationRequired")) ||
		(kind == StateTopupRequired && allPaidPlansArePayg(jsGet(limits, "plans")))

	gate := jsObject{"product": productRef}
	if activation {
		gate["kind"] = "activation_required"
		confirmationURL := jsGet(limits, "confirmationUrl")
		switch {
		case jsTruthy(confirmationURL):
			gate["checkoutUrl"] = confirmationURL
		case jsTruthy(checkoutURL):
			gate["checkoutUrl"] = checkoutURL
		default:
			gate["checkoutUrl"] = ""
		}
		gate.set("confirmationUrl", confirmationURL)
	} else {
		gate["kind"] = "payment_required"
		if jsTruthy(checkoutURL) {
			gate["checkoutUrl"] = checkoutURL
		} else {
			gate["checkoutUrl"] = ""
		}
	}
	gate.set("balance", jsGet(limits, "balance"))
	gate.set("productDetails", jsGet(limits, "product"))
	recoveryFields(limits, kind, gate)
	gate["message"] = BuildGateMessage(kind, gate)
	return gate
}
