package livecontract

// Requires is an optional backend capability gate for a scenario.
type Requires string

const (
	// RequiresStripe needs a Stripe-enabled sandbox.
	RequiresStripe Requires = "stripe"
	// RequiresActivePurchase needs an active purchase ref (skipped in single-side live).
	RequiresActivePurchase Requires = "activePurchase"
)

// Scenario is one live-contract scenario.
type Scenario struct {
	// ID is the stable scenario id (report key).
	ID string
	// Op is the camelCase operation name (manifest / dispatch).
	Op string
	// Args is the JSON args template ({productRef} placeholders).
	Args map[string]any
	// Requires is an optional capability requirement.
	Requires Requires
	// ExpectError scores a structured SDK error as IDENTICAL when true.
	ExpectError bool
	// SkipReason is recorded when a capability gate trips.
	SkipReason string
}

// SCENARIOS lists all live scenarios (36 unique ops + bogus probes) in dependency order.
var SCENARIOS = []Scenario{
	{ID: "getMerchant", Op: "getMerchant", Args: map[string]any{}},
	{ID: "getPlatformConfig", Op: "getPlatformConfig", Args: map[string]any{}},
	{
		ID: "createProduct", Op: "createProduct",
		Args: map[string]any{"name": "Shadow Product Scenario {sideTag}", "config": map[string]any{}, "metadata": map[string]any{}},
	},
	{ID: "listProducts", Op: "listProducts", Args: map[string]any{}},
	{ID: "getProduct", Op: "getProduct", Args: map[string]any{"productRef": "{productRef}"}},
	{
		ID: "updateProduct", Op: "updateProduct",
		Args: map[string]any{"productRef": "{productRef}", "name": "Shadow Product Updated {sideTag}"},
	},
	{
		ID: "cloneProduct", Op: "cloneProduct",
		Args:        map[string]any{"productRef": "{productRef}", "name": "Shadow Product Clone {sideTag}"},
		ExpectError: true,
	},
	{
		ID: "bootstrapMcpProduct", Op: "bootstrapMcpProduct",
		Args:        map[string]any{"originUrl": "https://mcp.shadow.example.com", "metadata": map[string]any{}},
		ExpectError: true,
	},
	{
		ID: "configureMcpPlans", Op: "configureMcpPlans",
		Args:        map[string]any{"productRef": "{productRef}", "plans": []any{}},
		ExpectError: true,
	},
	{
		ID: "createPlan", Op: "createPlan",
		Args: map[string]any{
			"productRef":   "{productRef}",
			"name":         "Shadow Plan",
			"type":         "recurring",
			"billingCycle": "monthly",
			"price":        1000,
			"currency":     "usd",
		},
	},
	{ID: "listPlans", Op: "listPlans", Args: map[string]any{"productRef": "{productRef}"}},
	{
		ID: "updatePlan", Op: "updatePlan",
		Args: map[string]any{
			"productRef": "{productRef}",
			"planRef":    "{planRef}",
			"name":       "Shadow Plan Updated",
		},
	},
	{
		ID: "createCustomer", Op: "createCustomer",
		Args: map[string]any{"email": "shadow-create-{sideTag}@example.com"},
	},
	{ID: "getCustomer", Op: "getCustomer", Args: map[string]any{"customerRef": "{customerRef}"}},
	{
		ID: "updateCustomer", Op: "updateCustomer",
		Args: map[string]any{"customerRef": "{customerRef}", "name": "Shadow Customer"},
	},
	{
		ID: "assignCredits", Op: "assignCredits",
		Args: map[string]any{"customerRef": "{customerRef}", "credits": 25},
	},
	{ID: "getCustomerBalance", Op: "getCustomerBalance", Args: map[string]any{"customerRef": "{customerRef}"}},
	{
		ID: "getUserInfo", Op: "getUserInfo",
		Args: map[string]any{"customerRef": "{customerRef}", "productRef": "{productRef}"},
	},
	{
		ID: "checkLimits", Op: "checkLimits",
		Args: map[string]any{"customerRef": "{customerRef}", "productRef": "{productRef}"},
	},
	{
		ID: "trackUsage", Op: "trackUsage",
		Args: map[string]any{"customerRef": "{customerRef}", "actionType": "api_call", "units": 1},
	},
	{
		ID: "trackUsageBulk", Op: "trackUsageBulk",
		Args: map[string]any{
			"events": []any{
				map[string]any{"customerRef": "{customerRef}", "actionType": "api_call", "units": 1},
			},
		},
	},
	{
		ID: "createCheckoutSession", Op: "createCheckoutSession",
		Args: map[string]any{"productRef": "{productRef}", "customerRef": "{customerRef}"},
	},
	{
		ID: "createCustomerSession", Op: "createCustomerSession",
		Args: map[string]any{"customerRef": "{customerRef}"},
	},
	{
		ID: "activatePlan", Op: "activatePlan",
		Args: map[string]any{
			"customerRef": "{customerRef}",
			"productRef":  "{productRef}",
			"planRef":     "{planRef}",
		},
	},
	{
		ID: "createPaymentIntent", Op: "createPaymentIntent",
		Args: map[string]any{
			"productRef":  "{productRef}",
			"planRef":     "{planRef}",
			"customerRef": "{customerRef}",
		},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "createTopupPaymentIntent", Op: "createTopupPaymentIntent",
		Args: map[string]any{
			"customerRef": "{customerRef}",
			"productRef":  "{productRef}",
			"amount":      500,
			"currency":    "USD",
		},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "processPaymentIntent", Op: "processPaymentIntent",
		Args: map[string]any{
			"processorPaymentId": "{paymentIntentId}",
			"customerRef":        "{customerRef}",
		},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "attachBusinessDetails", Op: "attachBusinessDetails",
		Args: map[string]any{
			"paymentIntentId": "{paymentIntentId}",
			"businessName":    "Shadow Co",
			"country":         "US",
		},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "cancelPurchase", Op: "cancelPurchase",
		Args:       map[string]any{"purchaseRef": "{purchaseRef}"},
		Requires:   RequiresActivePurchase,
		SkipReason: "requires: activePurchase",
	},
	{
		ID: "reactivatePurchase", Op: "reactivatePurchase",
		Args:       map[string]any{"purchaseRef": "{purchaseRef}"},
		Requires:   RequiresActivePurchase,
		SkipReason: "requires: activePurchase",
	},
	{
		ID: "getPaymentMethod", Op: "getPaymentMethod",
		Args:       map[string]any{"customerRef": "{customerRef}"},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe (Stripe customer)",
	},
	{
		ID: "getAutoRecharge", Op: "getAutoRecharge",
		Args:       map[string]any{"customerRef": "{customerRef}"},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "saveAutoRecharge", Op: "saveAutoRecharge",
		Args: map[string]any{
			"customerRef": "{customerRef}",
			"enabled":     true,
			"threshold":   100,
			"topupAmount": 500,
		},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "disableAutoRecharge", Op: "disableAutoRecharge",
		Args:       map[string]any{"customerRef": "{customerRef}"},
		Requires:   RequiresStripe,
		SkipReason: "requires: stripe",
	},
	{
		ID: "getProduct-bogus", Op: "getProduct",
		Args:        map[string]any{"productRef": "prd_shadow_does_not_exist_zzzz"},
		ExpectError: true,
	},
	{
		ID: "getCustomer-bogus", Op: "getCustomer",
		Args:        map[string]any{"customerRef": "cus_shadow_does_not_exist_zzzz"},
		ExpectError: true,
	},
	{
		ID: "deletePlan", Op: "deletePlan",
		Args: map[string]any{"productRef": "{productRef}", "planRef": "{planRef}"},
	},
	{ID: "deleteProduct", Op: "deleteProduct", Args: map[string]any{"productRef": "{productRef}"}},
}
