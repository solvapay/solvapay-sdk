package solvapay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/solvapay/solvapay-go/internal/nativecall"
)

const defaultLimitsCacheTTL = time.Duration(DefaultLimitsCacheTTLMs) * time.Millisecond

// GateOpts configures Client.Gate.
type GateOpts struct {
	Product   string
	UsageType string
}

// GateOutcome is the result of a paywall gate check.
type GateOutcome interface{ isGateOutcome() }

// Paywall is the gated arm; Gate is the layer-2 structured content, verbatim.
type Paywall struct {
	Gate json.RawMessage
}

func (*Paywall) isGateOutcome() {}

// Allow is the proceed arm; call TrackSuccess / TrackFail after the handler.
type Allow struct {
	client      *Client
	backendRef  string
	product     string
	meterName   string
	limits      map[string]any
	customer    CustomerSnapshot
	driverState any
}

func (*Allow) isGateOutcome() {}

// TrackOpts configures usage tracking after an allowed request.
type TrackOpts struct {
	Duration *float64
	Metadata map[string]any
}

// CustomerSnapshot is the merchant-facing customer projection from the last limits check.
type CustomerSnapshot struct {
	Ref          string
	Balance      any
	Remaining    any
	WithinLimits any
	Plan         any
}

// Customer returns the snapshot used by payable MCP ResponseContext.
func (a *Allow) Customer() CustomerSnapshot {
	if a == nil {
		return CustomerSnapshot{}
	}
	return a.customer
}

func customerSnapshotFromAction(action map[string]any, backendRef string) (CustomerSnapshot, error) {
	raw, ok := action["customer"].(map[string]any)
	if !ok {
		return CustomerSnapshot{}, &Error{Code: "internal_error", Message: "gate_next missing customer snapshot"}
	}
	ref, _ := raw["ref"].(string)
	if ref == "" {
		ref = backendRef
	}
	return CustomerSnapshot{Ref: ref, Balance: raw["balance"], Remaining: raw["remaining"], WithinLimits: raw["withinLimits"], Plan: raw["plan"]}, nil
}

// TrackSuccess records a successful usage event.
func (a *Allow) TrackSuccess(ctx context.Context, opts TrackOpts) error {
	duration := 0.0
	if opts.Duration != nil {
		duration = *opts.Duration
	}
	return a.client.emitHandlerUsage(ctx, a.driverState, map[string]any{
		"kind":       "handlerSucceeded",
		"durationMs": duration,
		"nowMs":      time.Now().UnixMilli(),
		"randomUnit": mustRandomUnit(),
	})
}

// TrackFail records a failed usage event.
func (a *Allow) TrackFail(ctx context.Context, cause error, opts TrackOpts) error {
	duration := 0.0
	if opts.Duration != nil {
		duration = *opts.Duration
	}
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	return a.client.emitHandlerUsage(ctx, a.driverState, map[string]any{
		"kind":           "handlerFailed",
		"durationMs":     duration,
		"nowMs":          time.Now().UnixMilli(),
		"randomUnit":     mustRandomUnit(),
		"errorMessage":   msg,
		"isPaywallError": IsPaywallError(cause),
	})
}

// Payable is a product-scoped gate helper.
type Payable struct {
	client    *Client
	product   string
	usageType string
}

// Payable returns a product-scoped gate helper.
func (c *Client) Payable(product, usageType string) *Payable {
	if usageType == "" {
		usageType = "requests"
	}
	return &Payable{client: c, product: product, usageType: usageType}
}

// Gate runs Client.Gate with this payable's product and usage type.
func (p *Payable) Gate(ctx context.Context, customerRef string) (GateOutcome, error) {
	return p.client.Gate(ctx, customerRef, GateOpts{Product: p.product, UsageType: p.usageType})
}

type gateState struct {
	mu sync.Mutex

	customerCache    map[string]customerCacheEntry
	customerInflight map[string]*customerInflight
	limitsCache      map[string]limitsCacheEntry
}

type customerCacheEntry struct {
	value       string
	timestampMs int64
}

type customerInflight struct {
	done chan struct{}
	ref  string
	err  error
}

type limitsCacheEntry struct {
	storedAt  time.Time
	remaining any
	limits    map[string]any
}

func newGateState() *gateState {
	return &gateState{
		customerCache:    map[string]customerCacheEntry{},
		customerInflight: map[string]*customerInflight{},
		limitsCache:      map[string]limitsCacheEntry{},
	}
}

// Gate classifies the customer, checks limits, and returns paywall or allow.
func (c *Client) Gate(ctx context.Context, customerRef string, opts GateOpts) (GateOutcome, error) {
	if c.gate == nil {
		c.gate = newGateState()
	}
	if opts.UsageType == "" {
		opts.UsageType = "requests"
	}
	if opts.Product == "" {
		return nil, &Error{Code: "invalid_config", Message: "product is required"}
	}
	startedMs := time.Now().UnixMilli()
	var state any
	event := map[string]any{
		"kind":             "start",
		"customerRef":      customerRef,
		"product":          opts.Product,
		"usageType":        opts.UsageType,
		"startedMs":        startedMs,
		"limitsCacheTTLMs": defaultLimitsCacheTTL.Milliseconds(),
	}
	var action map[string]any
	for {
		outJSON, err := callDecisionJSON(ctx, "sv_gate_next_binding", map[string]any{
			"state": state,
			"event": event,
		})
		if err != nil {
			return nil, err
		}
		var out struct {
			State  any            `json:"state"`
			Action map[string]any `json:"action"`
		}
		if err := json.Unmarshal(outJSON, &out); err != nil {
			return nil, fmt.Errorf("solvapay: gate_next: %w", err)
		}
		state = out.State
		action = out.Action
		kind, _ := action["kind"].(string)
		switch kind {
		case "ensureCustomer":
			ref, _ := action["customerRef"].(string)
			backendRef, err := c.ensureCustomer(ctx, ref)
			if err != nil {
				return nil, err
			}
			event = map[string]any{
				"kind":       "customerResolved",
				"backendRef": backendRef,
				"nowMs":      time.Now().UnixMilli(),
			}
		case "readLimitsCache":
			key, _ := action["key"].(string)
			now := time.Now().UnixMilli()
			c.gate.mu.Lock()
			cached, hit := c.gate.limitsCache[key]
			c.gate.mu.Unlock()
			if hit {
				event = map[string]any{
					"kind":        "limitsCacheEntry",
					"randomUnit":  mustRandomUnit(),
					"found":       true,
					"remaining":   cached.remaining,
					"limits":      cached.limits,
					"timestampMs": cached.storedAt.UnixMilli(),
					"nowMs":       now,
				}
			} else {
				event = map[string]any{
					"kind":       "limitsCacheEntry",
					"found":      false,
					"nowMs":      now,
					"randomUnit": mustRandomUnit(),
				}
			}
		case "checkLimits":
			if deleteKey, ok := action["cacheDeleteKey"].(string); ok && deleteKey != "" {
				c.gate.mu.Lock()
				delete(c.gate.limitsCache, deleteKey)
				c.gate.mu.Unlock()
			}
			raw, err := c.CheckLimits(ctx, map[string]any{
				"customerRef":            action["customerRef"],
				"productRef":             action["productRef"],
				"meterName":              action["meterName"],
				"includeCheckoutSession": asBool(action["includeCheckoutSession"]),
			})
			if err != nil {
				return nil, err
			}
			limits, ok := raw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("solvapay: checkLimits returned a non-object body")
			}
			event = map[string]any{
				"kind":       "limitsResult",
				"limits":     limits,
				"nowMs":      time.Now().UnixMilli(),
				"randomUnit": mustRandomUnit(),
			}
		case "allow":
			if err := c.applyGateCache(action["cache"]); err != nil {
				return nil, err
			}
			backendRef, _ := action["customerRef"].(string)
			meterName, _ := action["meterName"].(string)
			customer, err := customerSnapshotFromAction(action, backendRef)
			if err != nil {
				return nil, err
			}
			return &Allow{
				client:      c,
				backendRef:  backendRef,
				product:     opts.Product,
				meterName:   meterName,
				limits:      asObject(action["limits"]),
				customer:    customer,
				driverState: state,
			}, nil
		case "gate":
			if err := c.applyGateCache(action["cache"]); err != nil {
				return nil, err
			}
			if request, ok := action["request"].(map[string]any); ok && request != nil {
				if err := c.postUsage(ctx, request); err != nil {
					return nil, err
				}
			}
			gate, err := json.Marshal(action["gate"])
			if err != nil {
				return nil, fmt.Errorf("solvapay: gate_next gate: %w", err)
			}
			return &Paywall{Gate: gate}, nil
		default:
			return nil, &Error{Code: "internal_error", Message: "gate_next returned unknown action kind"}
		}
	}
}

func (c *Client) applyGateCache(raw any) error {
	cache, ok := raw.(map[string]any)
	if !ok || cache == nil {
		return nil
	}
	op, _ := cache["op"].(string)
	key, _ := cache["key"].(string)
	if key == "" {
		return nil
	}
	c.gate.mu.Lock()
	defer c.gate.mu.Unlock()
	switch op {
	case "delete":
		delete(c.gate.limitsCache, key)
	case "updateRemaining":
		entry := c.gate.limitsCache[key]
		entry.remaining = cache["remaining"]
		c.gate.limitsCache[key] = entry
	case "set":
		ts := time.UnixMilli(int64(asFloat(cache["timestamp"])))
		c.gate.limitsCache[key] = limitsCacheEntry{
			storedAt:  ts,
			remaining: cache["remaining"],
			limits:    asObject(cache["limits"]),
		}
	}
	return nil
}

func callDecisionJSON(ctx context.Context, fn string, args map[string]any) (json.RawMessage, error) {
	value, err := nativecall.CallValueJSON(ctx, fn, mustJSON(args))
	if err != nil {
		return nil, guestToError(err)
	}
	return value, nil
}

func guestToError(err error) error {
	var g *nativecall.GuestError
	if errors.As(err, &g) {
		return &Error{Code: g.Code, Message: g.Message, Status: g.Status, Retryable: g.Retryable}
	}
	return err
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func asObject(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func asBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	default:
		return false
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}
