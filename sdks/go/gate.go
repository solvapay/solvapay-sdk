package solvapay

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/solvapay/solvapay-go/internal/nativecall"
)

const (
	customerDedupTTL      = 60 * time.Second
	defaultLimitsCacheTTL = 10 * time.Second
	base36Alphabet        = "0123456789abcdefghijklmnopqrstuvwxyz"
)

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
	client     *Client
	backendRef string
	product    string
	meterName  string
	limits     map[string]any
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
	limits := a.limits
	if limits == nil {
		limits = map[string]any{}
	}
	balance := limits["creditBalance"]
	if balance == nil {
		balance = 0
	}
	within := limits["withinLimits"]
	if within == nil {
		within = true
	}
	return CustomerSnapshot{
		Ref:          a.backendRef,
		Balance:      balance,
		Remaining:    limits["remaining"],
		WithinLimits: within,
		Plan:         limits["plan"],
	}
}

// TrackSuccess records a successful usage event.
func (a *Allow) TrackSuccess(ctx context.Context, opts TrackOpts) error {
	return a.track(ctx, "success", opts)
}

// TrackFail records a failed usage event.
func (a *Allow) TrackFail(ctx context.Context, cause error, opts TrackOpts) error {
	_ = cause
	return a.track(ctx, "fail", opts)
}

func (a *Allow) track(ctx context.Context, outcome string, opts TrackOpts) error {
	duration := 0.0
	if opts.Duration != nil {
		duration = *opts.Duration
	}
	return a.client.trackUsage(ctx, a.backendRef, a.product, a.meterName, outcome, duration)
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
	limitsTTL        time.Duration
}

type customerCacheEntry struct {
	value     string
	expiresAt time.Time
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
		limitsTTL:        defaultLimitsCacheTTL,
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
	started := time.Now()
	backendRef, err := c.ensureCustomer(ctx, customerRef)
	if err != nil {
		return nil, err
	}
	usageType := opts.UsageType
	limitsKey := backendRef + ":" + opts.Product + ":" + usageType
	now := time.Now()

	var withinLimits bool
	var lastLimits map[string]any

	c.gate.mu.Lock()
	cached, hit := c.gate.limitsCache[limitsKey]
	ttl := c.gate.limitsTTL
	c.gate.mu.Unlock()

	if hit && now.Sub(cached.storedAt) < ttl {
		evalJSON, err := callDecisionJSON(ctx, "sv_evaluate_cached_limits_binding", map[string]any{
			"remaining": cached.remaining,
		})
		if err != nil {
			return nil, err
		}
		var eval struct {
			WithinLimits bool `json:"withinLimits"`
			Remaining    any  `json:"remaining"`
			Evict        bool `json:"evict"`
		}
		if err := json.Unmarshal(evalJSON, &eval); err != nil {
			return nil, fmt.Errorf("solvapay: evaluate_cached_limits: %w", err)
		}
		withinLimits = eval.WithinLimits
		c.gate.mu.Lock()
		if withinLimits {
			entry := c.gate.limitsCache[limitsKey]
			entry.remaining = eval.Remaining
			c.gate.limitsCache[limitsKey] = entry
		}
		if eval.Evict {
			delete(c.gate.limitsCache, limitsKey)
		}
		lastLimits = cached.limits
		c.gate.mu.Unlock()
	} else {
		if hit {
			c.gate.mu.Lock()
			delete(c.gate.limitsCache, limitsKey)
			c.gate.mu.Unlock()
		}
		raw, err := c.CheckLimits(ctx, map[string]any{
			"customerRef": backendRef,
			"productRef":  opts.Product,
			"meterName":   usageType,
		})
		if err != nil {
			return nil, err
		}
		lastLimits = asObject(raw)
		freshJSON, err := callDecisionJSON(ctx, "sv_evaluate_fresh_limits_binding", map[string]any{
			"withinLimits": asBool(lastLimits["withinLimits"]),
			"remaining":    asFloat(lastLimits["remaining"]),
		})
		if err != nil {
			return nil, err
		}
		var fresh struct {
			WithinLimits bool `json:"withinLimits"`
			Remaining    any  `json:"remaining"`
			ShouldCache  bool `json:"shouldCache"`
		}
		if err := json.Unmarshal(freshJSON, &fresh); err != nil {
			return nil, fmt.Errorf("solvapay: evaluate_fresh_limits: %w", err)
		}
		withinLimits = fresh.WithinLimits
		if fresh.ShouldCache {
			c.gate.mu.Lock()
			c.gate.limitsCache[limitsKey] = limitsCacheEntry{
				storedAt:  now,
				remaining: fresh.Remaining,
				limits:    lastLimits,
			}
			c.gate.mu.Unlock()
		}
	}

	checkoutURL, _ := lastLimits["checkoutUrl"].(string)
	decisionJSON, err := callDecisionJSON(ctx, "sv_decide_paywall_outcome_binding", map[string]any{
		"withinLimits": withinLimits,
		"product":      opts.Product,
		"limits":       lastLimits,
		"checkoutUrl":  checkoutURL,
	})
	if err != nil {
		return nil, err
	}
	var decision struct {
		Outcome string          `json:"outcome"`
		Gate    json.RawMessage `json:"gate"`
	}
	if err := json.Unmarshal(decisionJSON, &decision); err != nil {
		return nil, fmt.Errorf("solvapay: decide_paywall_outcome: %w", err)
	}

	meterJSON, err := callDecisionJSON(ctx, "sv_resolve_check_limits_params_binding", map[string]any{
		"productRef": opts.Product,
		"usageType":  usageType,
	})
	if err != nil {
		return nil, err
	}
	var resolved struct {
		MeterName string `json:"meterName"`
	}
	if err := json.Unmarshal(meterJSON, &resolved); err != nil {
		return nil, fmt.Errorf("solvapay: resolve_check_limits_params: %w", err)
	}
	if resolved.MeterName == "" {
		return nil, &Error{Code: "internal_error", Message: "resolve_check_limits_params returned unexpected value"}
	}

	if decision.Outcome == "gate" {
		gate := decision.Gate
		if len(gate) == 0 || string(gate) == "null" {
			built, err := callDecisionJSON(ctx, "sv_build_paywall_gate_binding", map[string]any{
				"productRef": opts.Product,
				"limits":     lastLimits,
			})
			if err != nil {
				return nil, err
			}
			gate = built
		}
		duration := float64(time.Since(started).Milliseconds())
		if duration < 0 {
			duration = 0
		}
		if err := c.trackUsage(ctx, backendRef, opts.Product, resolved.MeterName, "paywall", duration); err != nil {
			return nil, err
		}
		return &Paywall{Gate: gate}, nil
	}

	return &Allow{
		client:     c,
		backendRef: backendRef,
		product:    opts.Product,
		meterName:  resolved.MeterName,
		limits:     lastLimits,
	}, nil
}

func (c *Client) ensureCustomer(ctx context.Context, customerRef string) (string, error) {
	kindVal, err := nativecall.CallSync(ctx, "sv_classify_customer_ref_binding", mustJSON(map[string]any{
		"customerRef": customerRef,
	}))
	if err != nil {
		return "", guestToError(err)
	}
	kind, _ := kindVal.(string)
	if kind == "anonymous" || kind == "backend" || strings.HasPrefix(customerRef, "cus_") {
		return customerRef, nil
	}

	now := time.Now()
	c.gate.mu.Lock()
	if entry, ok := c.gate.customerCache[customerRef]; ok && now.Before(entry.expiresAt) {
		c.gate.mu.Unlock()
		return entry.value, nil
	}
	if inf, ok := c.gate.customerInflight[customerRef]; ok {
		c.gate.mu.Unlock()
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-inf.done:
			return inf.ref, inf.err
		}
	}
	inf := &customerInflight{done: make(chan struct{})}
	c.gate.customerInflight[customerRef] = inf
	c.gate.mu.Unlock()

	ref, err := c.findOrCreateCustomer(ctx, customerRef)
	inf.ref, inf.err = ref, err
	c.gate.mu.Lock()
	delete(c.gate.customerInflight, customerRef)
	if err == nil {
		c.gate.customerCache[customerRef] = customerCacheEntry{
			value:     ref,
			expiresAt: time.Now().Add(customerDedupTTL),
		}
	}
	c.gate.mu.Unlock()
	close(inf.done)
	return ref, err
}

func (c *Client) findOrCreateCustomer(ctx context.Context, customerRef string) (string, error) {
	existing, err := c.GetCustomer(ctx, map[string]any{"externalRef": customerRef})
	if err == nil {
		obj := asObject(existing)
		if ref, _ := obj["customerRef"].(string); ref != "" {
			return ref, nil
		}
	}

	var email any
	if strings.Contains(customerRef, "@") {
		email = customerRef
	}
	paramsJSON, err := callDecisionJSON(ctx, "sv_build_create_customer_params_binding", map[string]any{
		"customerRef": customerRef,
		"externalRef": customerRef,
		"email":       email,
		"nowMs":       time.Now().UnixMilli(),
	})
	if err != nil {
		return "", err
	}
	var params map[string]any
	if err := json.Unmarshal(paramsJSON, &params); err != nil {
		return "", fmt.Errorf("solvapay: build_create_customer_params: %w", err)
	}
	created, err := c.CreateCustomer(ctx, params)
	if err != nil {
		return "", err
	}
	refVal, err := nativecall.CallSync(ctx, "sv_extract_backend_customer_ref_binding", mustJSON(map[string]any{
		"response": created,
		"fallback": customerRef,
	}))
	if err != nil {
		return "", guestToError(err)
	}
	ref, _ := refVal.(string)
	if ref == "" {
		return "", &Error{Code: "internal_error", Message: "create_customer did not return customerRef"}
	}
	return ref, nil
}

func (c *Client) trackUsage(ctx context.Context, customerRef, productRef, action, outcome string, duration float64) error {
	payload := map[string]any{
		"customerRef": customerRef,
		"actionType":  "api_call",
		"units":       1,
		"outcome":     outcome,
		"productRef":  productRef,
		"duration":    duration,
		"metadata": map[string]any{
			"action":    action,
			"requestId": generateRequestID(),
		},
		"timestamp": time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z"),
	}
	_, err := c.TrackUsage(ctx, payload)
	return err
}

func generateRequestID() string {
	suffix := make([]byte, 9)
	for i := range suffix {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(base36Alphabet))))
		if err != nil {
			n = big.NewInt(int64(time.Now().UnixNano() % int64(len(base36Alphabet))))
		}
		suffix[i] = base36Alphabet[n.Int64()]
	}
	return fmt.Sprintf("solvapay_%d_%s", time.Now().UnixMilli(), suffix)
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
