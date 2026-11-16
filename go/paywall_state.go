package solvapay

// Paywall state and copy, ported from @solvapay/server's paywall-state.ts
// (Python: paywall/state.py). Classifies a limits response into the recovery
// the customer needs, and writes the gate and nudge messages. Inputs and
// outputs are JSON objects with the API's camelCase keys; the conformance
// suite checks the result against TypeScript, message text included.

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// CheckoutSessionTTLMinutes is how long a checkout link in a gate lasts.
const CheckoutSessionTTLMinutes = 15

// PaywallStateKind is the recovery a customer needs.
type PaywallStateKind string

const (
	StateActivationRequired   PaywallStateKind = "activation_required"
	StateTopupRequired        PaywallStateKind = "topup_required"
	StateUpgradeRequired      PaywallStateKind = "upgrade_required"
	StateLimitReached         PaywallStateKind = "limit_reached"
	StateReactivationRequired PaywallStateKind = "reactivation_required"
)

// nextActionFor is the machine-readable next step for a state.
func nextActionFor(kind PaywallStateKind) string {
	switch kind {
	case StateActivationRequired:
		return "activate"
	case StateTopupRequired:
		return "topup"
	case StateUpgradeRequired, StateLimitReached:
		return "checkout"
	case StateReactivationRequired:
		return "account"
	}
	panic(fmt.Sprintf("solvapay: unknown paywall state %q", kind))
}

// creditSignals coalesces the two credit-balance channels; nested balance wins.
// Values are undefined when absent.
type creditSignals struct {
	creditBalance, creditsPerCall, shortfallCredits, remainingCalls any
	isCreditBased                                                   bool
}

func readCreditSignals(limits map[string]any) creditSignals {
	if limits == nil {
		return creditSignals{jsUndefined, jsUndefined, jsUndefined, jsUndefined, false}
	}
	balance := jsGet(limits, "balance")
	creditBalance := jsCoalesce(jsGet(balance, "creditBalance"), jsGet(limits, "creditBalance"))
	creditsPerCall := jsCoalesce(jsGet(balance, "creditsPerUnit"), jsGet(limits, "creditsPerUnit"))
	signals := creditSignals{
		creditBalance:    creditBalance,
		creditsPerCall:   creditsPerCall,
		shortfallCredits: jsUndefined,
		remainingCalls:   jsUndefined,
		isCreditBased:    creditBalance != jsUndefined || creditsPerCall != jsUndefined,
	}
	if creditBalance != jsUndefined && creditsPerCall != jsUndefined {
		signals.shortfallCredits = math.Max(0, jsNumber(creditsPerCall)-jsNumber(creditBalance))
	}
	switch {
	case jsGet(balance, "remainingUnits") != jsUndefined:
		signals.remainingCalls = jsGet(balance, "remainingUnits")
	case creditBalance != jsUndefined && creditsPerCall != jsUndefined && jsNumber(creditsPerCall) > 0:
		signals.remainingCalls = math.Floor(jsNumber(creditBalance) / jsNumber(creditsPerCall))
	case jsNumber(jsGet(limits, "remaining")) >= 0:
		signals.remainingCalls = jsGet(limits, "remaining")
	}
	return signals
}

func activePlanRef(limits map[string]any) any {
	ref := jsCoalesce(jsGet(limits, "planRef"), jsGet(limits, "plan"))
	if s, ok := jsNonEmptyString(ref); ok {
		return s
	}
	return jsUndefined
}

// ClassifyPaywallState says which recovery the customer needs, with the same
// precedence as the TypeScript SDK.
func ClassifyPaywallState(limits map[string]any) PaywallStateKind {
	if limits == nil {
		return StateUpgradeRequired
	}
	reason := jsGet(limits, "paywallReason")
	if jsGet(limits, "activationRequired") == true || reason == "activation_required" {
		return StateActivationRequired
	}
	if reason == "limit_reached" {
		return StateLimitReached
	}
	if reason == "topup_required" {
		return StateTopupRequired
	}
	if jsGet(limits, "needsTopUp") == true {
		return StateTopupRequired
	}
	signals := readCreditSignals(limits)
	balance, cost := signals.creditBalance, signals.creditsPerCall
	if signals.isCreditBased {
		if balance != jsUndefined && cost != jsUndefined && jsNumber(balance) < jsNumber(cost) {
			return StateTopupRequired
		}
		if n, ok := jsNum(balance); ok && n == 0 {
			return StateTopupRequired
		}
		if n, ok := jsNum(jsGet(limits, "remaining")); cost == jsUndefined && ok && n == 0 {
			return StateTopupRequired
		}
	}
	if (jsTruthy(jsGet(limits, "purchaseRef")) || activePlanRef(limits) != jsUndefined) && jsNumber(jsGet(limits, "remaining")) <= 0 {
		return StateLimitReached
	}
	if signals.isCreditBased {
		return StateTopupRequired
	}
	if jsTruthy(jsGet(limits, "purchaseRef")) {
		return StateLimitReached
	}
	return StateUpgradeRequired
}

func formatCredits(value any) string { return formatCount(value) }

func formatCreditsWithMoney(credits any, gate map[string]any) string {
	amount := formatCredits(credits)
	peg := jsGet(gate, "creditsPerMinorUnit")
	currency, hasCurrency := jsNonEmptyString(jsGet(gate, "currency"))
	rate := jsGet(gate, "displayExchangeRate")
	// `rate != null` in the TypeScript: neither null nor undefined.
	hasRate := !jsNullish(rate) && jsNumber(rate) > 0
	if jsTruthy(peg) && jsNumber(peg) > 0 && hasCurrency && hasRate {
		minor, ok := CreditsToDisplayMinorUnits(jsNumber(credits), jsNumber(peg), jsNumber(rate), currency)
		if ok {
			return fmt.Sprintf("%s credits (~%s)", amount, FormatMinor(minor, currency))
		}
	}
	return amount + " credits"
}

func isFreeMeter(name any) bool {
	s, ok := name.(string)
	return ok && strings.HasPrefix(s, "free-")
}

func meterLabel(gate map[string]any) string {
	name := jsGet(gate, "meterName")
	if !jsTruthy(name) {
		return "units"
	}
	return strings.NewReplacer("_", " ", "-", " ").Replace(jsString(name))
}

func paywallCheckoutMarkdown(url, label string) string { return "[" + label + "](" + url + ")" }

// linkLabel escapes markdown link-label delimiters: plan names are merchant-authored.
func linkLabel(name string) string {
	return strings.NewReplacer("[", `\[`, "]", `\]`).Replace(name)
}

func planLadder(gate map[string]any) (string, bool) {
	plans, _ := jsCoalesce(jsGet(gate, "plans"), []any{}).([]any)
	planRef := jsGet(gate, "planRef")
	var linkable []map[string]any
	for _, p := range plans {
		plan, _ := p.(map[string]any)
		if _, ok := jsNonEmptyString(jsGet(plan, "checkoutUrl")); ok && !jsStrictEqual(jsGet(plan, "reference"), planRef) {
			linkable = append(linkable, plan)
		}
	}
	sort.SliceStable(linkable, func(i, j int) bool {
		return jsNumber(jsGet(linkable[i], "price")) < jsNumber(jsGet(linkable[j], "price"))
	})
	if len(linkable) > 4 {
		linkable = linkable[:4]
	}
	if len(linkable) == 0 {
		return "", false
	}
	links := make([]string, len(linkable))
	for i, p := range linkable {
		name := jsString(jsCoalesce(jsGet(p, "name"), jsGet(p, "reference")))
		links[i] = fmt.Sprintf("[%s](%s)", linkLabel(name), p["checkoutUrl"])
	}
	return fmt.Sprintf("%s (first link used closes the rest; links expire in %d minutes)",
		strings.Join(links, " · "), CheckoutSessionTTLMinutes), true
}

const viewerTool = "account"

func callViewer(view string) string {
	if view != "" {
		return fmt.Sprintf("call the `%s` tool with view: '%s'", viewerTool, view)
	}
	return fmt.Sprintf("call the `%s` tool", viewerTool)
}

func capital(text string) string {
	if strings.HasPrefix(text, "c") {
		return "C" + text[1:]
	}
	return text
}

func recoverClause(url, verb, view, label string) string {
	if url != "" {
		return fmt.Sprintf(" %s to %s (expires in %d minutes), or %s.",
			paywallCheckoutMarkdown(url, label), verb, CheckoutSessionTTLMinutes, callViewer(view))
	}
	return " " + capital(callViewer(view)) + "."
}

func hasActivePlan(gate map[string]any) bool {
	_, hasPlan := jsNonEmptyString(jsGet(gate, "planRef"))
	return jsTruthy(jsGet(gate, "purchaseRef")) || hasPlan
}

func autoRechargeDisabled(gate map[string]any) bool {
	return jsGet(jsGet(gate, "autoRecharge"), "enabled") == false
}

// BuildGateMessage is the gate message: it names one recovery tool and inlines
// the checkout link.
func BuildGateMessage(kind PaywallStateKind, gate map[string]any) string {
	url, _ := jsNonEmptyString(jsGet(gate, "checkoutUrl"))
	ladder, hasLadder := planLadder(gate)

	switch kind {
	case StateLimitReached:
		included := jsGet(gate, "included")
		if isFreeMeter(jsGet(gate, "meterName")) {
			total := jsGet(included, "total")
			usedLine := fmt.Sprintf("You've used all %s for this period.", meterLabel(gate))
			if total != jsUndefined {
				usedLine = fmt.Sprintf("You've used all %s %s for this period.", jsString(total), meterLabel(gate))
			}
			switchLine := recoverClause(url, "keep going", "checkout", "Open checkout")
			if hasLadder {
				switchLine = fmt.Sprintf(" Pick a plan to keep going: %s. %s for usage and recovery.", ladder, capital(callViewer("account")))
			}
			return usedLine + switchLine
		}
		price := ""
		unitPrice := jsGet(gate, "unitPriceMinor")
		if currency, ok := jsNonEmptyString(jsGet(gate, "currency")); ok && !jsNullish(unitPrice) {
			price = FormatMinor(jsNumber(unitPrice), currency)
		}
		usedLine := "You've reached the included usage for this period."
		if jsTruthy(included) {
			usedLine = fmt.Sprintf("You've used %s of %s included %s this period.",
				jsString(jsGet(included, "used")), jsString(jsGet(included, "total")), meterLabel(gate))
		}
		nextLine := ""
		if price != "" {
			nextLine = fmt.Sprintf(" The next call is %s.", price)
		}
		planName := jsString(jsCoalesce(jsGet(gate, "planName"), "This plan"))
		creditBalance := jsGet(gate, "creditBalance")
		creditsPerCall := jsGet(gate, "creditsPerCall")
		antiTrap := ""
		if creditBalance != jsUndefined && jsNumber(creditBalance) > 0 {
			if n, ok := jsNum(creditsPerCall); creditsPerCall == jsUndefined || (ok && n == 0) {
				antiTrap = fmt.Sprintf(" Adding credits will not help, because %s does not spend them.", planName)
			}
		}
		switchLine := recoverClause(url, "continue", "checkout", "Open checkout")
		if hasLadder {
			switchLine = fmt.Sprintf(" Or switch plan: %s. %s for usage and recovery.", ladder, capital(callViewer("account")))
		}
		return usedLine + nextLine + antiTrap + switchLine

	case StateActivationRequired:
		return fmt.Sprintf("Your plan needs activation.%s Or call `activate_plan` with a `planRef`.",
			recoverClause(url, "activate", "checkout", "Open checkout"))

	case StateTopupRequired:
		balance := jsGet(gate, "creditBalance")
		cost := jsGet(gate, "creditsPerCall")
		shortfall := jsGet(gate, "shortfallCredits")
		lead := "Included usage is exhausted."
		if balance != jsUndefined && cost != jsUndefined && shortfall != jsUndefined {
			lead = fmt.Sprintf("Out of credits for this call. Balance %s; this call costs %s — %s short.",
				formatCreditsWithMoney(balance, gate), formatCreditsWithMoney(cost, gate), formatCredits(shortfall))
		}
		topup := recoverClause(url, "add credits", "topup", "Add credits")
		auto := ""
		if autoRechargeDisabled(gate) {
			auto = fmt.Sprintf(" Auto-recharge is off — %s to turn it on and avoid this next time.", callViewer("account"))
		}
		switchLine := ""
		switch {
		case hasLadder:
			switchLine = fmt.Sprintf(" Or switch plan: %s.", ladder)
		case hasActivePlan(gate):
		default:
			switchLine = fmt.Sprintf(" Or %s to pick a plan.", callViewer("checkout"))
		}
		return lead + topup + auto + switchLine

	case StateUpgradeRequired:
		if hasLadder {
			return fmt.Sprintf("You don't have an active plan for this tool. Pick a plan to use this tool: %s, or %s. %s for usage and recovery.",
				ladder, callViewer("checkout"), capital(callViewer("account")))
		}
		return "You don't have an active plan for this tool." + recoverClause(url, "pick a plan", "checkout", "Open checkout")
	}

	return fmt.Sprintf("Your previous plan is no longer active. %s to reactivate it, or %s to pick a new plan.",
		capital(callViewer("account")), callViewer("checkout"))
}

// BuildNudgeMessage is the softer message appended to a successful call that
// is near a limit. limits may be nil.
func BuildNudgeMessage(kind PaywallStateKind, limits map[string]any) string {
	visit := ""
	if url, ok := jsNonEmptyString(jsGet(limits, "checkoutUrl")); ok {
		visit = ", or " + paywallCheckoutMarkdown(url, "Open checkout")
	}
	signals := readCreditSignals(limits)
	remaining := signals.remainingCalls
	outOfCalls := false
	if n, ok := jsNum(remaining); ok && n == 0 {
		outOfCalls = true
	}
	// `limits && …` in the TypeScript: any object, even an empty one, is truthy.
	if kind == StateTopupRequired && limits != nil && !signals.isCreditBased {
		kind = StateLimitReached
	}
	switch kind {
	case StateTopupRequired:
		if outOfCalls {
			return fmt.Sprintf("Heads up — 0 calls left — the next call needs a top-up. %s to add more%s.", capital(callViewer("topup")), visit)
		}
		return fmt.Sprintf("Heads up — running low on credits. %s to add more%s.", capital(callViewer("topup")), visit)
	case StateUpgradeRequired, StateLimitReached:
		if outOfCalls {
			return fmt.Sprintf("Heads up — 0 calls left — the next call needs a top-up. %s for more headroom%s.", capital(callViewer("checkout")), visit)
		}
		return fmt.Sprintf("Heads up — approaching your plan's limit this period. %s for more headroom%s.", capital(callViewer("checkout")), visit)
	case StateActivationRequired:
		return fmt.Sprintf("Heads up — this plan still needs activation. Call the `activate_plan` tool with a `planRef`%s.", visit)
	}
	return fmt.Sprintf("Heads up — your plan is no longer active. %s to reactivate it%s.", capital(callViewer("account")), visit)
}
