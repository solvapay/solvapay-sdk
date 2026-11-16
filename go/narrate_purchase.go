package solvapay

// The customer's current plan purchase, ported from @solvapay/mcp-core's
// active-purchase.ts, and the one credit signal narration reads (from
// @solvapay/server's creditSignals; the paywall port owns the full version).

import "sort"

// IsPlanPurchase reports whether purchase is a plan purchase, not a credit top-up.
func IsPlanPurchase(purchase map[string]any) bool {
	if jsGet(purchase, "origin") == "credit_topup" || jsGet(jsGet(purchase, "metadata"), "purpose") == "credit_topup" {
		return false
	}
	return jsTruthy(jsGet(purchase, "planSnapshot"))
}

func purchaseStartTime(purchase map[string]any) int64 {
	start := jsGet(purchase, "startDate")
	if !jsTruthy(start) {
		return 0
	}
	parsed, ok := parseJSDate(start)
	if !ok {
		return 0
	}
	return parsed.UnixMilli()
}

// SelectActivePlanPurchase is the customer's current plan purchase: active
// (or without a status), on productRef when it is not "", and not a top-up.
// The newest start wins; paid beats free only on the same start. nil when
// there is none. purchases is decoded JSON: a []any of objects.
func SelectActivePlanPurchase(purchases any, productRef string) map[string]any {
	var list []map[string]any
	switch items := purchases.(type) {
	case []any:
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				list = append(list, m)
			}
		}
	case []map[string]any:
		list = items
	}
	var candidates []map[string]any
	for _, purchase := range list {
		if status := jsGet(purchase, "status"); jsTruthy(status) && status != "active" {
			continue
		}
		if !IsPlanPurchase(purchase) {
			continue
		}
		if productRef != "" && jsGet(purchase, "productRef") != productRef {
			continue
		}
		candidates = append(candidates, purchase)
	}
	if len(candidates) == 0 {
		return nil
	}
	paid := func(p map[string]any) bool { return jsNumber(jsCoalesce(jsGet(p, "amount"), 0.0)) > 0 }
	// Array.prototype.sort is stable: equal keys keep their order.
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := purchaseStartTime(candidates[i]), purchaseStartTime(candidates[j])
		if a != b {
			return a > b
		}
		return paid(candidates[i]) && !paid(candidates[j])
	})
	return candidates[0]
}

// limitsAreCreditBased is creditSignals(limits).isCreditBased: the limits
// response carries a credit balance or a per-call credit cost.
func limitsAreCreditBased(limits any) bool {
	if !jsTruthy(limits) {
		return false
	}
	balance := jsGet(limits, "balance")
	creditBalance := jsCoalesce(jsGet(balance, "creditBalance"), jsGet(limits, "creditBalance"))
	creditsPerCall := jsCoalesce(jsGet(balance, "creditsPerUnit"), jsGet(limits, "creditsPerUnit"))
	return creditBalance != jsUndefined || creditsPerCall != jsUndefined
}
