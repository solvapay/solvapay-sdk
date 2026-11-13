package solvapay

// The API endpoints the MCP server calls: the account snapshot (merchant,
// product, plans, customer, card, balance, portal and checkout links) and
// the widget's payment, renewal and history calls. Answers stay JSON
// (map[string]any): the MCP tools pass them on to the widget as they came,
// as the TypeScript SDK does.

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// APIBaseURL is the SolvaPay API this client talks to, without a trailing slash.
func (c *Client) APIBaseURL() string { return c.baseURL }

func (c *Client) object(ctx context.Context, method, path string, query url.Values, headers http.Header, body any) (map[string]any, error) {
	raw, err := c.Request(ctx, method, path, query, headers, body)
	if err != nil {
		return nil, err
	}
	return decodeObject(raw)
}

func (c *Client) withSegment(ctx context.Context, method, before, segment, after string, body any) (map[string]any, error) {
	escaped, err := PathSegment(segment)
	if err != nil {
		return nil, err
	}
	return c.object(ctx, method, before+escaped+after, nil, nil, body)
}

// GetMerchant reads the merchant this secret key belongs to (GET /v1/sdk/merchant).
func (c *Client) GetMerchant(ctx context.Context) (map[string]any, error) {
	return c.object(ctx, http.MethodGet, "/v1/sdk/merchant", nil, nil, nil)
}

// GetPlatformConfig reads the platform's public settings, such as the Stripe publishable key.
func (c *Client) GetPlatformConfig(ctx context.Context) (map[string]any, error) {
	return c.object(ctx, http.MethodGet, "/v1/sdk/platform-config", nil, nil, nil)
}

// GetProduct reads one product (GET /v1/sdk/products/{productRef}).
func (c *Client) GetProduct(ctx context.Context, productRef string) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodGet, "/v1/sdk/products/", productRef, "", nil)
}

// ListPlans lists a product's plans (GET /v1/sdk/products/{productRef}/plans).
func (c *Client) ListPlans(ctx context.Context, productRef string) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodGet, "/v1/sdk/products/", productRef, "/plans", nil)
}

// GetCustomer reads a customer with their purchases (GET /v1/sdk/customers/{reference}).
func (c *Client) GetCustomer(ctx context.Context, reference string) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodGet, "/v1/sdk/customers/", reference, "", nil)
}

// GetCustomerBalance reads a customer's credit balance.
func (c *Client) GetCustomerBalance(ctx context.Context, reference string) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodGet, "/v1/sdk/customers/", reference, "/balance", nil)
}

// GetPaymentMethod reads the card a customer pays with (GET /v1/sdk/payment-method).
func (c *Client) GetPaymentMethod(ctx context.Context, customerRef string) (map[string]any, error) {
	return c.object(ctx, http.MethodGet, "/v1/sdk/payment-method", url.Values{"customerRef": {customerRef}}, nil, nil)
}

// CreateCustomerSession opens a customer portal session (POST /v1/sdk/customers/customer-sessions).
func (c *Client) CreateCustomerSession(ctx context.Context, body map[string]any) (map[string]any, error) {
	return c.object(ctx, http.MethodPost, "/v1/sdk/customers/customer-sessions", nil, nil, body)
}

// CreateCheckoutSession opens a hosted checkout session (POST /v1/sdk/checkout-sessions).
func (c *Client) CreateCheckoutSession(ctx context.Context, body map[string]any) (map[string]any, error) {
	return c.object(ctx, http.MethodPost, "/v1/sdk/checkout-sessions", nil, nil, body)
}

// ActivatePlan activates a plan for a customer (POST /v1/sdk/activate).
func (c *Client) ActivatePlan(ctx context.Context, body map[string]any) (map[string]any, error) {
	return c.object(ctx, http.MethodPost, "/v1/sdk/activate", nil, nil, body)
}

// CreatePaymentIntent creates a Stripe payment intent (POST /v1/sdk/payment-intents).
// idempotencyKey is required: the same key never charges twice.
func (c *Client) CreatePaymentIntent(ctx context.Context, body map[string]any, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		return nil, newError("invalid_argument", "CreatePaymentIntent needs an idempotency key")
	}
	return c.object(ctx, http.MethodPost, "/v1/sdk/payment-intents", nil, http.Header{"Idempotency-Key": {idempotencyKey}}, body)
}

// ProcessPaymentIntent creates the purchase for a confirmed payment intent.
func (c *Client) ProcessPaymentIntent(ctx context.Context, processorPaymentID string, body map[string]any) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodPost, "/v1/sdk/payment-intents/", processorPaymentID, "/process", body)
}

// AttachBusinessDetails attaches a buyer's business details to a payment
// intent and answers the tax breakdown.
func (c *Client) AttachBusinessDetails(ctx context.Context, processorPaymentID string, body any) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodPost, "/v1/sdk/payment-intents/", processorPaymentID, "/business-details", body)
}

// CancelPurchase cancels a purchase's renewal (POST /v1/sdk/purchases/{ref}/cancel).
func (c *Client) CancelPurchase(ctx context.Context, purchaseRef string, body map[string]any) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodPost, "/v1/sdk/purchases/", purchaseRef, "/cancel", body)
}

// ReactivatePurchase undoes a pending cancellation (POST /v1/sdk/purchases/{ref}/reactivate).
func (c *Client) ReactivatePurchase(ctx context.Context, purchaseRef string) (map[string]any, error) {
	return c.withSegment(ctx, http.MethodPost, "/v1/sdk/purchases/", purchaseRef, "/reactivate", nil)
}

// ListPurchases lists a customer's purchases of a product (GET /v1/sdk/purchases).
func (c *Client) ListPurchases(ctx context.Context, customerRef, productRef string) (map[string]any, error) {
	return c.object(ctx, http.MethodGet, "/v1/sdk/purchases", url.Values{"customerRef": {customerRef}, "productRef": {productRef}}, nil, nil)
}

// GetCreditActivity lists a customer's credit events, newest first; limit 0 means the API's default.
func (c *Client) GetCreditActivity(ctx context.Context, customerRef string, limit int) (map[string]any, error) {
	query := url.Values{"customerRef": {customerRef}}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	return c.object(ctx, http.MethodGet, "/v1/sdk/credits/activity", query, nil, nil)
}
