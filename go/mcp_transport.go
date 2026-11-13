package solvapay

// The widget's transport tools, ported from @solvapay/mcp-core's
// descriptors.ts and the @solvapay/server *Core helpers they call
// (packages/server/src/helpers).
//
// The SolvaPay widget calls these from its iframe to pay, top up, cancel or
// reactivate a renewal, open a hosted page and load history. They are not for
// the model: each carries _meta.ui.visibility ['app'] and _meta.audience 'ui'.
// Each answers like TypeScript's toolResult (the data as JSON text and as
// structured content) or toolErrorResult ({error, status, details}). The
// customer is the signed-in cus_ ref, used as is.

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const uiOnlyPrefix = "UI-only; agents should prefer `" + viewerToolName + "` / `" + activatePlanToolName + "`. "

// renewalSettle is how long set_renewal waits after the API answers, as
// cancelPurchaseCore and reactivatePurchaseCore do, so the widget's next read
// sees the change.
var renewalSettle = 500 * time.Millisecond

// maxSafeInteger is zod's int() bound, which the input schemas advertise as maximum.
const maxSafeInteger = 9007199254740991

// idempotencyKey is "<prefix>-<ms>-<9 random characters>".
func idempotencyKey(prefix string) string {
	var b [9]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = requestIDAlphabet[int(b[i])%len(requestIDAlphabet)]
	}
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixMilli(), b[:])
}

func stringProperty() map[string]any { return map[string]any{"type": "string"} }

func (s *MCPServer) registerTransportTools() error {
	meta := transportToolMeta(s.resourceURI)
	add := func(name, description string, annotations ToolAnnotations, properties map[string]any, required []string,
		body func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error)) error {
		annotations.OpenWorldHint = Hint(true) // every SolvaPay tool talks to the SolvaPay API
		return s.addTool(toolSpec{
			name:        name,
			description: uiOnlyPrefix + description,
			annotations: annotations,
			meta:        meta,
			inputSchema: map[string]any{"type": "object", "properties": properties, "required": stringsAsAny(required)},
			handler: func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, error) {
				customerRef, err := s.customerRef(ctx, req, nil)
				if err != nil {
					return nil, err
				}
				if customerRef == "" {
					return toolErrorResult("Unauthorized", 401, unauthorizedDetails), nil
				}
				return body(ctx, customerRef, args)
			},
		})
	}
	productOr := func(args map[string]any) string {
		if product := textArg(args, "productRef"); product != "" {
			return product
		}
		return s.productRef
	}

	// ---- create_hosted_session
	err := add("create_hosted_session",
		`Create a SolvaPay hosted session and return its URL. Pass kind: "checkout" for a hosted checkout URL (fallback when Stripe Elements is blocked) or kind: "portal" for the customer portal URL.`,
		ToolAnnotations{ReadOnlyHint: Hint(false), DestructiveHint: Hint(false), IdempotentHint: Hint(true)},
		map[string]any{
			"kind":       map[string]any{"type": "string", "enum": []any{"checkout", "portal"}, "description": `"checkout" for hosted checkout; "portal" for customer portal.`},
			"planRef":    stringProperty(),
			"productRef": stringProperty(),
		}, []string{"kind"},
		func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error) {
			kind := args["kind"]
			if kind != "checkout" && kind != "portal" {
				return toolErrorResult("create_hosted_session requires kind", 400, `Pass kind: "checkout" or kind: "portal".`), nil
			}
			if kind == "portal" {
				portal, err := s.client.CreateCustomerSession(ctx, map[string]any{"customerRef": customerRef})
				if err != nil {
					return apiErrorResult(err)
				}
				return toolResult(portal)
			}
			body := map[string]any{"productRef": productOr(args), "customerRef": customerRef}
			if planRef := textArg(args, "planRef"); planRef != "" {
				body["planRef"] = planRef
			}
			// MCP has no page to come back to, so no returnUrl (createMcpCheckoutSession).
			session, err := s.client.CreateCheckoutSession(ctx, body)
			if err != nil {
				return apiErrorResult(err)
			}
			return toolResult(map[string]any{"sessionId": jsCoalesce(jsGet(session, "sessionId"), nil), "checkoutUrl": jsCoalesce(jsGet(session, "checkoutUrl"), nil)})
		})
	if err != nil {
		return err
	}

	// ---- create_payment_intent
	positiveMajor := map[string]any{"type": "number", "exclusiveMinimum": 0}
	intentResult := func(intent map[string]any, customerRef string) (*mcp.CallToolResult, error) {
		data := map[string]any{
			"processorPaymentId": jsCoalesce(jsGet(intent, "processorPaymentId"), nil),
			"clientSecret":       jsCoalesce(jsGet(intent, "clientSecret"), nil),
			"publishableKey":     jsCoalesce(jsGet(intent, "publishableKey"), nil),
			"customerRef":        customerRef,
		}
		if account := jsGet(intent, "accountId"); !jsNullish(account) {
			data["accountId"] = account
		}
		return toolResult(data)
	}
	err = add("create_payment_intent",
		`Create a Stripe payment intent for the authenticated customer. Pass purpose: "plan" to purchase a plan (returns { clientSecret, publishableKey, accountId?, customerRef }) or purpose: "topup" for a credit top-up (credits are recorded by webhook after confirmation). A topup may carry autoRecharge so the card entered for the top-up is saved as the auto-recharge funding source.`,
		ToolAnnotations{ReadOnlyHint: Hint(false), DestructiveHint: Hint(false)},
		map[string]any{
			"purpose":     map[string]any{"type": "string", "enum": []any{"plan", "topup"}, "description": `"plan" for plan checkout; "topup" for credit top-up.`},
			"planRef":     stringProperty(),
			"productRef":  stringProperty(),
			"currency":    stringProperty(),
			"amount":      map[string]any{"type": "integer", "exclusiveMinimum": 0, "maximum": maxSafeInteger},
			"description": stringProperty(),
			"autoRecharge": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"enabled":              map[string]any{"type": "boolean"},
					"triggerType":          map[string]any{"type": "string", "const": "balance"},
					"thresholdAmountMajor": positiveMajor,
					"topupAmountMajor":     positiveMajor,
					"maxMonthlySpendMajor": positiveMajor,
					"currency":             map[string]any{"type": "string", "minLength": 3, "maxLength": 3},
				},
				"required": []any{"enabled", "triggerType", "currency"},
			},
		}, []string{"purpose"},
		func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error) {
			purpose := args["purpose"]
			if purpose != "plan" && purpose != "topup" {
				return toolErrorResult("create_payment_intent requires purpose", 400, `Pass purpose: "plan" or purpose: "topup".`), nil
			}
			autoRecharge, hasAutoRecharge := args["autoRecharge"]
			hasAutoRecharge = hasAutoRecharge && autoRecharge != nil
			if purpose == "plan" && hasAutoRecharge {
				return toolErrorResult("create_payment_intent plan does not accept autoRecharge", 400, `autoRecharge is only honoured on purpose: "topup".`), nil
			}
			if purpose == "topup" {
				amount := args["amount"]
				currency := textArg(args, "currency")
				if !jsTruthy(amount) || currency == "" {
					return toolErrorResult("create_payment_intent topup requires amount and currency", 400, `Pass purpose: "topup" with amount (integer cents) and currency.`), nil
				}
				if currency != strings.ToUpper(currency) {
					return toolErrorResult(fmt.Sprintf(`Invalid currency "%s": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")`, currency), 400), nil
				}
				body := map[string]any{"customerRef": customerRef, "purpose": "credit_topup", "amount": amount, "currency": currency}
				if description, ok := args["description"].(string); ok {
					body["description"] = description
				}
				if hasAutoRecharge {
					// zod drops keys it does not know, so this does too.
					known := map[string]any{}
					for _, key := range []string{"enabled", "triggerType", "thresholdAmountMajor", "topupAmountMajor", "maxMonthlySpendMajor", "currency"} {
						if value := jsGet(autoRecharge, key); !jsNullish(value) {
							known[key] = value
						}
					}
					body["autoRecharge"] = known
				}
				intent, err := s.client.CreatePaymentIntent(ctx, body, idempotencyKey("topup"))
				if err != nil {
					return apiErrorResult(err)
				}
				return intentResult(intent, customerRef)
			}
			planRef := textArg(args, "planRef")
			if planRef == "" {
				return toolErrorResult("create_payment_intent plan requires planRef", 400, `Pass purpose: "plan" with planRef and productRef.`), nil
			}
			body := map[string]any{"productRef": productOr(args), "planRef": planRef, "customerRef": customerRef}
			if currency := textArg(args, "currency"); currency != "" {
				body["currency"] = currency
			}
			intent, err := s.client.CreatePaymentIntent(ctx, body, idempotencyKey("payment-"+planRef))
			if err != nil {
				return apiErrorResult(err)
			}
			return intentResult(intent, customerRef)
		})
	if err != nil {
		return err
	}

	// ---- process_payment
	err = add("process_payment",
		"Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.",
		ToolAnnotations{DestructiveHint: Hint(true)},
		map[string]any{"paymentIntentId": stringProperty(), "productRef": stringProperty(), "planRef": stringProperty()},
		[]string{"paymentIntentId", "productRef"},
		func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error) {
			paymentIntentID := textArg(args, "paymentIntentId")
			if paymentIntentID == "" {
				return toolErrorResult("paymentIntentId and productRef are required", 400), nil
			}
			body := map[string]any{"productRef": productOr(args), "customerRef": customerRef}
			if planRef := textArg(args, "planRef"); planRef != "" {
				body["planRef"] = planRef
			}
			result, err := s.client.ProcessPaymentIntent(ctx, paymentIntentID, body)
			if err != nil {
				return apiErrorResult(err)
			}
			return toolResult(result)
		})
	if err != nil {
		return err
	}

	// ---- attach_business_details
	err = add("attach_business_details",
		"Attach business purchase details to a payment intent and retrieve the computed tax breakdown.",
		ToolAnnotations{ReadOnlyHint: Hint(false), DestructiveHint: Hint(false), IdempotentHint: Hint(true)},
		map[string]any{
			"paymentIntentId":    stringProperty(),
			"isBusiness":         map[string]any{"type": "boolean"},
			"businessName":       stringProperty(),
			"country":            stringProperty(),
			"customerCountry":    stringProperty(),
			"customerName":       stringProperty(),
			"customerState":      stringProperty(),
			"customerPostalCode": stringProperty(),
			"taxId":              stringProperty(),
			"taxIdType":          map[string]any{"type": "string", "enum": stringsAsAny(TaxIDTypes)},
		}, []string{"paymentIntentId", "isBusiness"},
		func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error) {
			paymentIntentID := textArg(args, "paymentIntentId")
			if paymentIntentID == "" {
				return toolErrorResult("paymentIntentId is required", 400), nil
			}
			text := func(key string) string { value, _ := args[key].(string); return value }
			details, err := ValidateBusinessDetails(BusinessDetailsInput{
				IsBusiness:         args["isBusiness"] == true,
				BusinessName:       text("businessName"),
				Country:            text("country"),
				CustomerCountry:    text("customerCountry"),
				CustomerName:       text("customerName"),
				CustomerState:      text("customerState"),
				CustomerPostalCode: text("customerPostalCode"),
				TaxID:              text("taxId"),
				TaxIDType:          text("taxIdType"),
			})
			var invalid *Error
			if errors.As(err, &invalid) && invalid.Code == "invalid_business_details" {
				return toolErrorResult(invalid.Message, 400), nil
			}
			if err != nil {
				return nil, err
			}
			body, err := toJSONValue(details)
			if err != nil {
				return nil, err
			}
			body.(map[string]any)["customerRef"] = customerRef
			result, err := s.client.AttachBusinessDetails(ctx, paymentIntentID, body)
			if err != nil {
				return apiErrorResult(err)
			}
			return toolResult(result)
		})
	if err != nil {
		return err
	}

	// ---- set_renewal
	renewalError := func(err error, refused string) (*mcp.CallToolResult, error) {
		var apiErr *Error
		if !errors.As(err, &apiErr) {
			return nil, err
		}
		switch apiErr.Status {
		case 404:
			return toolErrorResult("Purchase not found", 404, apiErr.Message), nil
		case 400:
			return toolErrorResult(refused, 400, apiErr.Message), nil
		}
		return toolErrorResult(apiErr.Message, 500, apiErr.Message), nil
	}
	purchaseOf := func(response map[string]any) map[string]any {
		if purchase, ok := response["purchase"].(map[string]any); ok {
			return purchase
		}
		return response
	}
	err = add("set_renewal",
		"Toggle auto-renewal on an active purchase. Pass enabled: false to cancel (access continues until period end) or enabled: true to undo a pending cancellation.",
		ToolAnnotations{DestructiveHint: Hint(true), IdempotentHint: Hint(true)},
		map[string]any{
			"purchaseRef": stringProperty(),
			"enabled":     map[string]any{"type": "boolean", "description": "true to reactivate auto-renewal; false to cancel renewal."},
			"reason":      stringProperty(),
		}, []string{"purchaseRef", "enabled"},
		func(ctx context.Context, _ string, args map[string]any) (*mcp.CallToolResult, error) {
			enabled, ok := args["enabled"].(bool)
			if !ok {
				return toolErrorResult("set_renewal requires enabled", 400, "Pass enabled: true to reactivate auto-renewal or enabled: false to cancel."), nil
			}
			purchaseRef := textArg(args, "purchaseRef")
			if purchaseRef == "" {
				return toolErrorResult("Missing required parameter: purchaseRef is required", 400), nil
			}
			if enabled {
				response, err := s.client.ReactivatePurchase(ctx, purchaseRef)
				if err != nil {
					return renewalError(err, "Purchase cannot be reactivated")
				}
				purchase := purchaseOf(response)
				if !jsTruthy(jsGet(purchase, "reference")) {
					return toolErrorResult("Reactivate purchase response missing required fields", 500), nil
				}
				if jsTruthy(jsGet(purchase, "cancelledAt")) {
					return toolErrorResult("Purchase reactivation failed: cancelledAt is still set", 500), nil
				}
				if err := sleep(ctx, renewalSettle); err != nil {
					return nil, err
				}
				return toolResult(purchase)
			}
			body := map[string]any{}
			if reason := textArg(args, "reason"); reason != "" {
				body["reason"] = reason
			}
			response, err := s.client.CancelPurchase(ctx, purchaseRef, body)
			if err != nil {
				return renewalError(err, "Purchase cannot be cancelled or does not belong to provider")
			}
			purchase := purchaseOf(response)
			if !jsTruthy(jsGet(purchase, "reference")) {
				return toolErrorResult("Cancel purchase response missing required fields", 500), nil
			}
			if jsGet(purchase, "status") != "cancelled" && !jsTruthy(jsGet(purchase, "cancelledAt")) {
				return toolErrorResult(fmt.Sprintf("Purchase cancellation failed: backend returned status '%s' without cancelledAt timestamp", jsString(jsGet(purchase, "status"))), 500), nil
			}
			if err := sleep(ctx, renewalSettle); err != nil {
				return nil, err
			}
			return toolResult(purchase)
		})
	if err != nil {
		return err
	}

	// ---- get_history
	return add("get_history",
		"Load product charge history and account-wide credit activity for the authenticated customer. Charges come from purchases for this product; credit activity is every credit event on the account.",
		ToolAnnotations{ReadOnlyHint: Hint(true), IdempotentHint: Hint(true)},
		map[string]any{
			"productRef": stringProperty(),
			"limit":      map[string]any{"type": "integer", "exclusiveMinimum": 0, "maximum": 100},
		}, nil,
		func(ctx context.Context, customerRef string, args map[string]any) (*mcp.CallToolResult, error) {
			product := productOr(args)
			limit := 0
			if n, ok := jsNum(args["limit"]); ok {
				limit = int(n)
			}
			type answer struct {
				value map[string]any
				err   error
			}
			purchasesDone, activityDone := make(chan answer, 1), make(chan answer, 1)
			go func() {
				value, err := s.client.ListPurchases(ctx, customerRef, product)
				purchasesDone <- answer{value, err}
			}()
			go func() {
				value, err := s.client.GetCreditActivity(ctx, customerRef, limit)
				activityDone <- answer{value, err}
			}()
			purchases, activity := <-purchasesDone, <-activityDone
			for _, read := range []answer{purchases, activity} {
				if read.err != nil {
					return apiErrorResult(read.err)
				}
			}
			charges, _ := jsCoalesce(jsGet(purchases.value, "purchases"), []any{}).([]any)
			if charges == nil {
				charges = []any{}
			}
			return toolResult(map[string]any{"charges": charges, "creditActivity": activity.value})
		})
}
