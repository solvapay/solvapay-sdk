package solvapay

// The snapshot behind the account tool and solvapay://bootstrap.json, ported
// from @solvapay/mcp-core (bootstrap-payload.ts, derive-view.ts,
// portal-links.ts, helpers.ts).
//
// BuildBootstrapPayload reads the merchant, product, plans and the signed-in
// customer's purchases, card, balance, limits and portal link in parallel,
// and shapes them as the TypeScript SDK does (BootstrapPayload). The
// merchant and the product must load; a failed customer read leaves its
// field null and is logged.

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"regexp"
	"strings"
	"sync"
)

// Views the account tool can land on. "auto-recharge" is still read from old
// transcripts, as account.
const (
	ViewCheckout = "checkout"
	ViewAccount  = "account"
	ViewTopup    = "topup"
)

// AdvertisedViews are the views the account tool offers, in schema order.
var AdvertisedViews = []string{ViewCheckout, ViewAccount, ViewTopup}

var viewPriority = []string{ViewCheckout, ViewTopup, ViewAccount}

const portalAutoRechargeQuery = "tab=credits&intent=autorecharge"

const providerNotFound = "Provider account not found on this SolvaPay deployment.\n" +
	"\n" +
	"The Worker secret key authenticates against SolvaPay, but no merchant\n" +
	"record exists for it. This usually means the secret key was created\n" +
	"manually (without running `solvapay init`) or the merchant was deleted.\n" +
	"\n" +
	"To recover:\n" +
	"  1. Run `npx solvapay init` in the project root. It will create the\n" +
	"     merchant on the backend and write a valid secret key to `.env`.\n" +
	"  2. Redeploy with `npm run deploy` to push the corrected secret to\n" +
	"     the Worker.\n" +
	"\n" +
	"No tool calls will succeed until the merchant exists."

// signedInCustomerRef is a signed-in customer, or "". "anonymous" is no customer.
func signedInCustomerRef(ref string) string {
	trimmed := jsTrim(ref)
	if trimmed == "anonymous" {
		return ""
	}
	return trimmed
}

// DeriveDefaultView is the view to land on when none is asked for: no plan →
// checkout, a top-up gate → topup, else account; the first enabled view in
// that order when the preferred one is turned off.
func DeriveDefaultView(payload map[string]any, enabled []string) (string, error) {
	customer := jsGet(payload, "customer")
	purchases := jsGet(jsGet(customer, "purchase"), "purchases")
	productRef, _ := jsGet(payload, "productRef").(string)
	preferred := ViewAccount
	switch {
	case SelectActivePlanPurchase(purchases, productRef) == nil:
		preferred = ViewCheckout
	case jsGet(customer, "nextAction") == "topup":
		preferred = ViewTopup
	}
	if containsString(enabled, preferred) {
		return preferred, nil
	}
	for _, view := range viewPriority {
		if containsString(enabled, view) {
			return view, nil
		}
	}
	return "", newError("invalid_argument", "DeriveDefaultView: no enabled views, so the account tool should not be registered")
}

var currencyCodeLike = regexp.MustCompile(`^[A-Za-z]{3}$`)

// minorUnitsDisplay is formatMinorUnits: Intl currency with fixed digits; ""
// where there is no amount or Intl would throw.
func minorUnitsDisplay(amount any, currency string) string {
	n, ok := jsNum(amount)
	if !ok || !currencyCodeLike.MatchString(currency) {
		return ""
	}
	return FormatMinor(n, currency)
}

// enrichPurchase is a purchase plus priceDisplay / priceUsdDisplay strings,
// and the snapshot's priceDisplay, so a model reading the JSON need not
// reason about minor units.
func enrichPurchase(purchase map[string]any) map[string]any {
	amount, original := jsGet(purchase, "amount"), jsGet(purchase, "originalAmount")
	currency, _ := jsGet(purchase, "currency").(string)
	out := copyJSON(purchase)
	priceDisplay := minorUnitsDisplay(original, currency)
	if priceDisplay == "" {
		priceDisplay = minorUnitsDisplay(amount, "USD")
	}
	if priceDisplay != "" {
		out["priceDisplay"] = priceDisplay
	}
	if currency != "" && strings.ToUpper(currency) != "USD" {
		if usd := minorUnitsDisplay(amount, "USD"); usd != "" {
			out["priceUsdDisplay"] = usd
		}
	}
	if snapshot, ok := jsGet(purchase, "planSnapshot").(map[string]any); ok {
		snapCurrency, _ := jsGet(snapshot, "currency").(string)
		if display := minorUnitsDisplay(jsGet(snapshot, "price"), snapCurrency); display != "" {
			withDisplay := copyJSON(snapshot)
			withDisplay["priceDisplay"] = display
			out["planSnapshot"] = withDisplay
		}
	}
	return out
}

var httpURLPrefix = regexp.MustCompile(`(?i)^https?://`)

// autoRechargeURLFrom is the portal URL opened on the auto-recharge form; nil without an http(s) URL.
func autoRechargeURLFrom(customerURL any) any {
	text, ok := customerURL.(string)
	if !ok || !httpURLPrefix.MatchString(text) {
		return nil
	}
	separator := "?"
	if strings.Contains(text, "?") {
		separator = "&"
	}
	return text + separator + portalAutoRechargeQuery
}

// deriveUsageSnapshot is consumption and cap from a limits answer. nil
// limits means the cap is unknown, not unlimited.
func deriveUsageSnapshot(periodStart, periodEnd, purchaseRef any, limits map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range map[string]any{"periodStart": periodStart, "periodEnd": periodEnd, "purchaseRef": purchaseRef} {
		if text, ok := jsNonEmptyString(value); ok {
			out[key] = text
		}
	}
	if limits == nil {
		for _, key := range []string{"meterRef", "total", "used", "remaining", "percentUsed"} {
			out[key] = nil
		}
		return out
	}
	var remaining, total, used, percent any
	if jsNumber(jsGet(limits, "remaining")) >= 0 {
		remaining = limits["remaining"]
	}
	if limit, ok := jsNum(jsGet(limits, "limit")); ok && limit > 0 {
		total = limit
	}
	if value, ok := jsNum(jsGet(limits, "used")); ok {
		used = value
	} else if total != nil && remaining != nil {
		used = math.Max(0, total.(float64)-jsNumber(remaining))
	}
	if total != nil && used != nil {
		percent = math.Min(100, jsRound(jsNumber(used)/total.(float64)*10000)/100)
	}
	out["meterRef"] = jsCoalesce(jsGet(limits, "meterName"), nil)
	out["total"] = total
	out["used"] = used
	out["remaining"] = remaining
	out["percentUsed"] = percent
	return out
}

// unwrapPlan spreads a plan's data under it, as the TypeScript client does.
func unwrapPlan(plan map[string]any) map[string]any {
	data, _ := plan["data"].(map[string]any)
	price := jsCoalesce(jsGet(plan, "price"), jsGet(data, "price"))
	out := map[string]any{}
	for key, value := range data {
		out[key] = value
	}
	for key, value := range plan {
		out[key] = value
	}
	if price != jsUndefined {
		out["price"] = price
	}
	delete(out, "data")
	return out
}

// BootstrapRequest is one snapshot to build.
type BootstrapRequest struct {
	View          string
	ProductRef    string
	PublicBaseURL string
	// CustomerRef is the signed-in customer; "" or "anonymous" is none.
	CustomerRef string
}

type bootstrapReader struct {
	client *Client
	logger *slog.Logger
}

// optional is a customer read that may fail: logged, and left out (nil).
func (b bootstrapReader) optional(name string, value map[string]any, err error) map[string]any {
	if err != nil {
		var status any
		var sdkErr *Error
		if errors.As(err, &sdkErr) {
			status = sdkErr.Status
		}
		b.logger.Warn("bootstrap: "+name+" failed; omitted from the payload", "error", err, "status", status)
		return nil
	}
	return value
}

// BuildBootstrapPayload is the BootstrapPayload for request.View. The
// merchant or the product failing to load is an *Error with the API's status.
func BuildBootstrapPayload(ctx context.Context, client *Client, request BootstrapRequest, logger *slog.Logger) (map[string]any, error) {
	if logger == nil {
		logger = slog.Default()
	}
	reader := bootstrapReader{client: client, logger: logger}
	ref := signedInCustomerRef(request.CustomerRef)
	signedIn := ref != ""
	product := request.ProductRef

	var (
		wg                                                        sync.WaitGroup
		merchant, productData, config, plansAnswer                map[string]any
		customer, paymentMethod, balance, limits, portal          map[string]any
		merchantErr, productErr, configErr, plansErr              error
		customerErr, paymentErr, balanceErr, limitsErr, portalErr error
	)
	run := func(read func()) {
		wg.Add(1)
		go func() { defer wg.Done(); read() }()
	}
	run(func() { merchant, merchantErr = client.GetMerchant(ctx) })
	run(func() { productData, productErr = client.GetProduct(ctx, product) })
	run(func() { config, configErr = client.GetPlatformConfig(ctx) })
	run(func() { plansAnswer, plansErr = client.ListPlans(ctx, product) })
	if signedIn {
		run(func() { customer, customerErr = client.GetCustomer(ctx, ref) })
		run(func() { paymentMethod, paymentErr = client.GetPaymentMethod(ctx, ref) })
		run(func() { balance, balanceErr = client.GetCustomerBalance(ctx, ref) })
		run(func() {
			limits, limitsErr = client.CheckLimits(ctx, map[string]any{"customerRef": ref, "productRef": product, "meterName": "requests"})
		})
		run(func() { portal, portalErr = client.CreateCustomerSession(ctx, map[string]any{"customerRef": ref}) })
	}
	wg.Wait()

	if merchantErr != nil {
		return nil, bootstrapError(merchantErr, func(e *Error) string {
			if e.Status == 404 {
				return providerNotFound
			}
			return "bootstrap: merchant lookup failed: " + e.Message
		})
	}
	if productErr != nil {
		return nil, bootstrapError(productErr, func(e *Error) string { return "bootstrap: product lookup failed: " + e.Message })
	}
	config = reader.optional("getPlatformConfig", config, configErr)
	plansAnswer = reader.optional("listPlans", plansAnswer, plansErr)
	customer = reader.optional("getCustomer", customer, customerErr)
	paymentMethod = reader.optional("getPaymentMethod", paymentMethod, paymentErr)
	balance = reader.optional("getCustomerBalance", balance, balanceErr)
	limits = reader.optional("checkLimits", limits, limitsErr)
	portal = reader.optional("createCustomerSession", portal, portalErr)

	plans := []any{}
	if listed, ok := jsCoalesce(jsGet(plansAnswer, "plans"), []any{}).([]any); ok {
		for _, plan := range listed {
			if object, ok := plan.(map[string]any); ok {
				plans = append(plans, unwrapPlan(object))
			}
		}
	}

	// checkLimits creates the free default purchase, so the parallel customer
	// read can predate it. Read again once when limits names a purchase it lacks.
	if needed, ok := jsNonEmptyString(jsGet(limits, "purchaseRef")); signedIn && ok {
		listed, _ := jsCoalesce(jsGet(customer, "purchases"), []any{}).([]any)
		found := false
		for _, purchase := range listed {
			if jsGet(purchase, "reference") == needed {
				found = true
			}
		}
		if !found {
			again, err := client.GetCustomer(ctx, ref)
			customer = reader.optional("getCustomer", again, err)
		}
	}

	var checkout map[string]any
	if signedIn {
		body := map[string]any{"productRef": product, "customerRef": ref}
		topupPurpose := request.View == ViewTopup ||
			(request.View != ViewCheckout && request.View != "auto-recharge" && jsGet(limits, "paywallReason") == "topup_required")
		if topupPurpose {
			body["purpose"] = "credit_topup"
		}
		answer, err := client.CreateCheckoutSession(ctx, body)
		checkout = reader.optional("createCheckoutSession", answer, err)
	}

	var purchase map[string]any
	if customer != nil {
		purchases := []any{}
		listed, _ := jsCoalesce(jsGet(customer, "purchases"), []any{}).([]any)
		for _, item := range listed {
			if object, ok := item.(map[string]any); ok && jsGet(object, "status") == "active" {
				purchases = append(purchases, enrichPurchase(object))
			}
		}
		purchase = map[string]any{"customerRef": jsCoalesce(jsGet(customer, "reference"), ref)}
		for _, key := range []string{"email", "name"} {
			if value := jsGet(customer, key); value != jsUndefined {
				purchase[key] = value
			}
		}
		purchase["purchases"] = purchases
	}

	var payloadCustomer any
	if signedIn {
		var purchases any
		if purchase != nil {
			purchases = purchase["purchases"]
		}
		active := SelectActivePlanPurchase(purchases, product)
		usage := jsGet(active, "usage")
		trimmedOrNil := func(value any) any {
			if text, ok := value.(string); ok && jsTrim(text) != "" {
				return jsTrim(text)
			}
			return nil
		}
		var activeRef any = jsUndefined
		if active != nil {
			activeRef = jsGet(active, "reference")
		}
		entry := map[string]any{
			"ref":           ref,
			"email":         trimmedOrNil(jsGet(purchase, "email")),
			"name":          trimmedOrNil(jsGet(purchase, "name")),
			"purchase":      nilIfEmpty(purchase),
			"paymentMethod": nilIfEmpty(paymentMethod),
			"balance":       nilIfEmpty(balance),
			"usage":         deriveUsageSnapshot(jsGet(usage, "periodStart"), jsGet(usage, "periodEnd"), activeRef, limits),
			"limits":        nilIfEmpty(limits),
		}
		if limits != nil {
			entry["canCall"] = jsGet(limits, "withinLimits") == true
			signals := readCreditSignals(limits)
			for key, value := range map[string]any{
				"remainingCalls":   signals.remainingCalls,
				"creditsPerCall":   signals.creditsPerCall,
				"shortfallCredits": signals.shortfallCredits,
			} {
				if value != jsUndefined {
					entry[key] = value
				}
			}
			entry["isCreditBased"] = signals.isCreditBased
			if value := jsGet(limits, "autoRecharge"); value != jsUndefined {
				entry["autoRecharge"] = value
			}
			if jsGet(limits, "withinLimits") == false {
				entry["nextAction"] = nextActionFor(ClassifyPaywallState(limits))
			}
		}
		payloadCustomer = entry
	}

	portalURL := jsCoalesce(jsGet(portal, "customerUrl"), nil)
	return map[string]any{
		"view":                 request.View,
		"productRef":           product,
		"stripePublishableKey": jsCoalesce(jsGet(config, "stripePublishableKey"), nil),
		"returnUrl":            request.PublicBaseURL,
		"merchant":             merchant,
		"product":              productData,
		"plans":                plans,
		"customer":             payloadCustomer,
		"checkoutUrl":          jsCoalesce(jsGet(checkout, "checkoutUrl"), nil),
		"portalUrl":            portalURL,
		"autoRechargeUrl":      autoRechargeURLFrom(portalURL),
	}, nil
}

// nilIfEmpty keeps a typed nil map from reading as {}: it is JSON null.
func nilIfEmpty(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

func bootstrapError(err error, message func(*Error) string) error {
	var sdkErr *Error
	if !errors.As(err, &sdkErr) {
		return err
	}
	return &Error{Code: sdkErr.Code, Status: sdkErr.Status, Message: message(sdkErr), Body: sdkErr.Body}
}
