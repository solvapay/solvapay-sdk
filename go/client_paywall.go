package solvapay

// The API endpoints the paywall calls: limits, customers and usage.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/solvapay/solvapay-sdk/go/api"
)

// CheckLimits asks the API whether a customer may make a paid call
// (POST /v1/sdk/limits). The answer stays JSON: the paywall passes its fields
// through to the gate as they came.
func (c *Client) CheckLimits(ctx context.Context, body map[string]any) (map[string]any, error) {
	raw, err := c.Request(ctx, http.MethodPost, "/v1/sdk/limits", nil, nil, body)
	if err != nil {
		return nil, err
	}
	limits, err := decodeObject(raw)
	if err != nil {
		return nil, err
	}
	if _, ok := limits["withinLimits"].(bool); !ok {
		return nil, &Error{Code: "invalid_response", Message: "The limits answer has no withinLimits", Body: string(raw)}
	}
	if _, ok := limits["remaining"].(float64); !ok {
		return nil, &Error{Code: "invalid_response", Message: "The limits answer has no remaining count", Body: string(raw)}
	}
	return limits, nil
}

// GetCustomerByExternalRef finds a customer by your own user id
// (GET /v1/sdk/customers?externalRef=…). A missing customer is an *Error with Status 404.
func (c *Client) GetCustomerByExternalRef(ctx context.Context, externalRef string) (api.CustomerResponse, error) {
	raw, err := c.Request(ctx, http.MethodGet, "/v1/sdk/customers", url.Values{"externalRef": {externalRef}}, nil, nil)
	if err != nil {
		return api.CustomerResponse{}, err
	}
	return decodeCustomer(raw)
}

// CreateCustomer creates a customer (POST /v1/sdk/customers).
func (c *Client) CreateCustomer(ctx context.Context, body map[string]any) (api.CustomerResponse, error) {
	raw, err := c.Request(ctx, http.MethodPost, "/v1/sdk/customers", nil, nil, body)
	if err != nil {
		return api.CustomerResponse{}, err
	}
	return decodeCustomer(raw)
}

// RecordUsage records one usage event (POST /v1/sdk/usages).
func (c *Client) RecordUsage(ctx context.Context, body map[string]any) error {
	_, err := c.Request(ctx, http.MethodPost, "/v1/sdk/usages", nil, nil, body)
	return err
}

func decodeCustomer(raw json.RawMessage) (api.CustomerResponse, error) {
	customer, err := Decode[api.CustomerResponse](raw)
	if err != nil {
		return customer, err
	}
	if customer.Reference == "" {
		return customer, &Error{Code: "invalid_response", Message: "The customer answer has no reference", Body: string(raw)}
	}
	return customer, nil
}

func decodeObject(raw json.RawMessage) (map[string]any, error) {
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return nil, &Error{Code: "invalid_response", Message: fmt.Sprintf("The SolvaPay API answered with something this SDK cannot read: %v", err), Body: string(raw)}
	}
	return out, nil
}
