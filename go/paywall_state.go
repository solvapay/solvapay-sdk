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
		return creditSignals{undefined, undefined, undefined, undefined, false}
	}
	balance := get(limits, "balance")
	creditBalance := coalesce(get(balance, "creditBalance"), get(limits, "creditBalance"))
	creditsPerCall := coalesce(get(balance, "creditsPerUnit"), get(limits, "creditsPerUnit"))
	signals := creditSignals{
		creditBalance:    creditBalance,
		creditsPerCall:   creditsPerCall,
		shortfallCredits: undefined,
		remainingCalls:   undefined,
		isCreditBased:    !isUndefined(creditBalance) || !isUndefined(creditsPerCall),
	}
	if !isUndefined(creditBalance) && !isUndefined(creditsPerCall) {
		signals.shortfallCredits = math.Max(0, number(creditsPerCall)-number(creditBalance))
	}
	switch {
	case !isUndefined(get(balance, "remainingUnits")):
		signals.remainingCalls = get(balance, "remainingUnits")
	case !isUndefined(creditBalance) && !isUndefined(creditsPerCall) && number(creditsPerCall) > 0:
		signals.remainingCalls = math.Floor(number(creditBalance) / number(creditsPerCall))
	case number(get(limits, "remaining")) >= 0:
		signals.remainingCalls = get(limits, "remaining")
	}
	return signals
}

func activePlanRef(limits map[string]any) any {
	ref := coalesce(get(limits, "planRef"), get(limits, "plan"))
	if s, ok := nonEmptyString(ref); ok {
		return s
	}
	return undefined
}

// ClassifyPaywallState says which recovery the customer needs, with the same
// precedence as the TypeScript SDK.
func ClassifyPaywallState(limits map[string]any) PaywallStateKind {
	if limits == nil {
		return StateUpgradeRequired
	}
	reason := get(limits, "paywallReason")
	if get(limits, "activationRequired") == true || reason == "activation_required" {
		return StateActivationRequired
	}
	if reason == "limit_reached" {
		return StateLimitReached
	}
	if reason == "topup_required" {
		return StateTopupRequired
	}
	if get(limits, "needsTopUp") == true {
		return StateTopupRequired
	}
	signals := readCreditSignals(limits)
	balance, cost := signals.creditBalance, signals.creditsPerCall
	if signals.isCreditBased {
		if !isUndefined(balance) && !isUndefined(cost) && number(balance) < number(cost) {
			return StateTopupRequired
		}
		if n, ok := asNumber(balance); ok && n == 0 {
			return StateTopupRequired
		}
		if n, ok := asNumber(get(limits, "remaining")); isUndefined(cost) && ok && n == 0 {
			return StateTopupRequired
		}
	}
	if (truthy(get(limits, "purchaseRef")) || !isUndefined(activePlanRef(limits))) && number(get(limits, "remaining")) <= 0 {
		return StateLimitReached
	}
	if signals.isCreditBased {
		return StateTopupRequired
	}
	if truthy(get(limits, "purchaseRef")) {
		return StateLimitReached
	}
	return StateUpgradeRequired
}

func formatCredits(value any) string { return toLocaleString(number(value)) }

func formatCreditsWithMoney(credits any, gate map[string]any) string {
	amount := formatCredits(credits)
	peg := get(gate, "creditsPerMinorUnit")
	currency, hasCurrency := nonEmptyString(get(gate, "currency"))
	rate := get(gate, "displayExchangeRate")
	// `rate != null` in the TypeScript: neither null nor undefined.
	hasRate := !nullish(rate) && number(rate) > 0
	if truthy(peg) && number(peg) > 0 && hasCurrency && hasRate {
		minor, ok := CreditsToDisplayMinorUnits(number(credits), number(peg), number(rate), currency)
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
	name := get(gate, "meterName")
	if !truthy(name) {
		return "units"
	}
	return strings.NewReplacer("_", " ", "-", " ").Replace(jsString(name))
}

func namedCheckoutMarkdown(url, label string) string { return "[" + label + "](" + url + ")" }

// linkLabel escapes markdown link-label delimiters: plan names are merchant-authored.
func linkLabel(name string) string {
	return strings.NewReplacer("[", `\[`, "]", `\]`).Replace(name)
}

func planLadder(gate map[string]any) (string, bool) {
	plans, _ := coalesce(get(gate, "plans"), []any{}).([]any)
	planRef := get(gate, "planRef")
	var linkable []map[string]any
	for _, p := range plans {
		plan, _ := p.(map[string]any)
		if _, ok := nonEmptyString(get(plan, "checkoutUrl")); ok && !jsStrictEqual(get(plan, "reference"), planRef) {
			linkable = append(linkable, plan)
		}
	}
	sort.SliceStable(linkable, func(i, j int) bool {
		return number(get(linkable[i], "price")) < number(get(linkable[j], "price"))
	})
	if len(linkable) > 4 {
		linkable = linkable[:4]
	}
	if len(linkable) == 0 {
		return "", false
	}
	links := make([]string, len(linkable))
	for i, p := range linkable {
		name := jsString(coalesce(get(p, "name"), get(p, "reference")))
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
			namedCheckoutMarkdown(url, label), verb, CheckoutSessionTTLMinutes, callViewer(view))
	}
	return " " + capital(callViewer(view)) + "."
}

func hasActivePlan(gate map[string]any) bool {
	_, hasPlan := nonEmptyString(get(gate, "planRef"))
	return truthy(get(gate, "purchaseRef")) || hasPlan
}

func autoRechargeDisabled(gate map[string]any) bool {
	return get(get(gate, "autoRecharge"), "enabled") == false
}

// BuildGateMessage is the gate message: it names one recovery tool and inlines
// the checkout link.
func BuildGateMessage(kind PaywallStateKind, gate map[string]any) string {
	url, _ := nonEmptyString(get(gate, "checkoutUrl"))
	ladder, hasLadder := planLadder(gate)

	switch kind {
	case StateLimitReached:
		included := get(gate, "included")
		if isFreeMeter(get(gate, "meterName")) {
			total := get(included, "total")
			usedLine := fmt.Sprintf("You've used all %s for this period.", meterLabel(gate))
			if !isUndefined(total) {
				usedLine = fmt.Sprintf("You've used all %s %s for this period.", jsString(total), meterLabel(gate))
			}
			switchLine := recoverClause(url, "keep going", "checkout", "Open checkout")
			if hasLadder {
				switchLine = fmt.Sprintf(" Pick a plan to keep going: %s. %s for usage and recovery.", ladder, capital(callViewer("account")))
			}
			return usedLine + switchLine
		}
		price := ""
		unitPrice := get(gate, "unitPriceMinor")
		if currency, ok := nonEmptyString(get(gate, "currency")); ok && !nullish(unitPrice) {
			price = FormatMinor(number(unitPrice), currency)
		}
		usedLine := "You've reached the included usage for this period."
		if truthy(included) {
			usedLine = fmt.Sprintf("You've used %s of %s included %s this period.",
				jsString(get(included, "used")), jsString(get(included, "total")), meterLabel(gate))
		}
		nextLine := ""
		if price != "" {
			nextLine = fmt.Sprintf(" The next call is %s.", price)
		}
		planName := jsString(coalesce(get(gate, "planName"), "This plan"))
		creditBalance := get(gate, "creditBalance")
		creditsPerCall := get(gate, "creditsPerCall")
		antiTrap := ""
		if !isUndefined(creditBalance) && number(creditBalance) > 0 {
			if n, ok := asNumber(creditsPerCall); isUndefined(creditsPerCall) || (ok && n == 0) {
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
		balance := get(gate, "creditBalance")
		cost := get(gate, "creditsPerCall")
		shortfall := get(gate, "shortfallCredits")
		lead := "Included usage is exhausted."
		if !isUndefined(balance) && !isUndefined(cost) && !isUndefined(shortfall) {
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
	if url, ok := nonEmptyString(get(limits, "checkoutUrl")); ok {
		visit = ", or " + namedCheckoutMarkdown(url, "Open checkout")
	}
	signals := readCreditSignals(limits)
	remaining := signals.remainingCalls
	outOfCalls := false
	if n, ok := asNumber(remaining); ok && n == 0 {
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
