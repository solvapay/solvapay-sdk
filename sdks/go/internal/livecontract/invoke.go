package livecontract

import (
	"context"
	"errors"
	"fmt"

	solvapay "github.com/solvapay/solvapay-go"
	"github.com/solvapay/solvapay-go/internal/dispatch"
)

// Invoke calls one camelCase operation and returns a JSON observation ({ok, value|error}).
func Invoke(ctx context.Context, client *solvapay.Client, op string, args map[string]any) map[string]any {
	if args == nil {
		args = map[string]any{}
	}
	value, err := dispatch.Call(client, ctx, op, args)
	if err != nil {
		return ErrOutcome(sdkErrorObservation(err))
	}
	return OkOutcome(value)
}

// SetupSide creates product / plan / customer fixtures for the live run.
func SetupSide(ctx context.Context, client *solvapay.Client, runID string) (map[string]string, error) {
	sideTag := "go-" + runID
	email := fmt.Sprintf("shadow-%s@example.com", sideTag)

	product := Invoke(ctx, client, "createProduct", map[string]any{
		"name":     fmt.Sprintf("Shadow Product %s", sideTag),
		"config":   map[string]any{},
		"metadata": map[string]any{},
	})
	if product["ok"] != true {
		return nil, fmt.Errorf("setup createProduct failed: %v", product)
	}
	productRef := ExtractRef(product["value"], []string{"reference", "productRef"})
	if productRef == "" {
		return nil, fmt.Errorf("setup missing productRef: %v", product)
	}

	plan := Invoke(ctx, client, "createPlan", map[string]any{
		"productRef":   productRef,
		"name":         fmt.Sprintf("Shadow Plan %s", sideTag),
		"type":         "recurring",
		"billingCycle": "monthly",
		"price":        1000,
		"currency":     "usd",
	})
	if plan["ok"] != true {
		return nil, fmt.Errorf("setup createPlan failed: %v", plan)
	}
	planRef := ExtractRef(plan["value"], []string{"reference", "planRef"})
	if planRef == "" {
		return nil, fmt.Errorf("setup missing planRef: %v", plan)
	}

	customer := Invoke(ctx, client, "createCustomer", map[string]any{"email": email})
	if customer["ok"] != true {
		return nil, fmt.Errorf("setup createCustomer failed: %v", customer)
	}
	customerRef := ExtractRef(customer["value"], []string{"customerRef", "reference"})
	if customerRef == "" {
		return nil, fmt.Errorf("setup missing customerRef: %v", customer)
	}

	return map[string]string{
		"productRef":      productRef,
		"planRef":         planRef,
		"customerRef":     customerRef,
		"email":           email,
		"sideTag":         sideTag,
		"purchaseRef":     "pur_missing_shadow",
		"paymentIntentId": "pi_missing_shadow",
	}, nil
}

func sdkErrorObservation(err error) map[string]any {
	var svErr *solvapay.Error
	if errors.As(err, &svErr) {
		obs := map[string]any{
			"name":    "SolvaPayError",
			"message": svErr.Message,
			"status":  nil,
			"code":    nil,
		}
		if svErr.Status != 0 {
			obs["status"] = svErr.Status
		}
		if svErr.Code != "" {
			obs["code"] = svErr.Code
		}
		return obs
	}
	return map[string]any{
		"name":    "SolvaPayError",
		"message": err.Error(),
		"status":  nil,
		"code":    nil,
	}
}
