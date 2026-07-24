package main

import (
	"context"
	"fmt"

	solvapay "github.com/solvapay/solvapay-go"
)

// run fetches the merchant profile via the public client.
func run(ctx context.Context, client *solvapay.Client) (map[string]any, error) {
	raw, err := client.GetMerchant(ctx)
	if err != nil {
		return nil, err
	}
	merchant, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("GetMerchant type = %T, want map[string]any", raw)
	}
	return merchant, nil
}
