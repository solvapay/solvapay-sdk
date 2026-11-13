package solvapay

import "context"

// PaidCall is one call of a function made paid with Payable: who calls it,
// and its arguments.
type PaidCall[A any] struct {
	// CustomerRef is a SolvaPay customer (cus_…), your own user id, or "anonymous".
	CustomerRef string
	Args        A
}

// PayableOptions says what a paid function is for.
type PayableOptions struct {
	// Product; empty means the Paywall's ProductRef.
	Product   string
	Meter     string
	FreeLimit *FreeLimit
	// ToolName is recorded with every usage event (Python takes it from the
	// function's name, TypeScript from its toolName option).
	ToolName string
}

// Payable makes handler a paid function. Each call is decided by the paywall
// first: a gate returns a *PaywallError (its Gate is the paywall to show the
// customer) without running handler; an allow runs it and records success or
// fail. A handler may gate its own call by returning NewPaywallError(gate).
//
// The product and free limit are checked here, so a misconfigured paid
// function fails when it is made, not when it is first called.
func Payable[A, T any](p *Paywall, options PayableOptions, handler func(context.Context, PaidCall[A]) (T, error)) (func(context.Context, PaidCall[A]) (T, error), error) {
	if p == nil || handler == nil {
		return nil, newError("invalid_argument", "Payable needs a Paywall and a handler")
	}
	product, err := p.requireProduct(options.Product)
	if err != nil {
		return nil, err
	}
	if options.FreeLimit != nil {
		if _, err := options.FreeLimit.normalised(); err != nil {
			return nil, err
		}
	}
	return func(ctx context.Context, call PaidCall[A]) (T, error) {
		var result T
		if call.CustomerRef == "" {
			return result, &Error{Code: "identity_required", Status: 401, Message: "A paid call needs a CustomerRef"}
		}
		decision, err := p.Decide(ctx, DecideParams{
			CustomerRef: call.CustomerRef,
			Product:     product,
			Meter:       options.Meter,
			FreeLimit:   options.FreeLimit,
			ToolName:    options.ToolName,
		})
		if err != nil {
			return result, err
		}
		if decision.Gate != nil {
			return result, NewPaywallError(decision.Gate)
		}
		err = p.RunAllow(ctx, decision, RunParams{
			Product:   product,
			Meter:     options.Meter,
			FreeLimit: options.FreeLimit,
			ToolName:  options.ToolName,
		}, func(ctx context.Context) error {
			var handlerErr error
			result, handlerErr = handler(ctx, call)
			return handlerErr
		})
		return result, err
	}, nil
}
