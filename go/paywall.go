package solvapay

// Whether a paid call may go ahead, ported from @solvapay/server's
// paywall.ts (Python: paywall/decide.py, whose deliberate differences from
// TypeScript this follows; see conformance/README.md "Known divergences"):
//
//   - Errors are told apart by status and code, never by message text.
//   - A customer lookup error other than 404 fails, instead of being logged
//     and skipped.
//   - A 409 on customer creation is resolved by one lookup by externalRef;
//     if that finds nothing it fails with customer_conflict.
//   - The customer cache belongs to the Paywall, so two clients with
//     different keys in one process never share a customer.
//
// Decide resolves the customer, checks the limits (from a short cache, or the
// API) and answers allow or gate. RunAllow runs the handler for an allow and
// records the usage. The rules about plans, credits and limits stay in the
// API; this only carries the answer to the caller.

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// DefaultLimitsCacheTTL is how long a limits answer is counted down from
// before the API is asked again.
const DefaultLimitsCacheTTL = 10 * time.Second

// usageRetryDelay is the wait before a usage event refused with 404 (a
// customer created moments ago) is sent again.
var usageRetryDelay = 500 * time.Millisecond

// PaywallOptions configures a Paywall. Zero values take the defaults.
type PaywallOptions struct {
	// ProductRef is the product a paid call is for when DecideParams.Product
	// is empty; empty means SOLVAPAY_PRODUCT_REF.
	ProductRef string
	// LimitsCacheTTL; zero means DefaultLimitsCacheTTL.
	LimitsCacheTTL time.Duration
	// Now is the clock: cache ages, request ids, usage timestamps and
	// durations read it. Nil means time.Now.
	Now func() time.Time
	// Logger receives usage events that could not be recorded. Nil means slog.Default().
	Logger *slog.Logger
}

// Paywall decides paid calls for one API client. It is safe for concurrent use.
type Paywall struct {
	client     *Client
	productRef string
	ttl        time.Duration
	now        func() time.Time
	logger     *slog.Logger

	mu              sync.Mutex
	customers       map[string]string
	customerLookups map[string]*flight[string]
	limits          map[string]*limitsEntry
	limitsFetches   map[string]*limitsFetch
}

// NewPaywall builds the paywall for client.
func NewPaywall(client *Client, options PaywallOptions) (*Paywall, error) {
	if client == nil {
		return nil, newError("invalid_argument", "NewPaywall needs a Client")
	}
	if options.LimitsCacheTTL < 0 {
		return nil, newError("invalid_argument", "LimitsCacheTTL cannot be negative")
	}
	p := &Paywall{
		client:          client,
		productRef:      options.ProductRef,
		ttl:             options.LimitsCacheTTL,
		now:             options.Now,
		logger:          options.Logger,
		customers:       map[string]string{},
		customerLookups: map[string]*flight[string]{},
		limits:          map[string]*limitsEntry{},
		limitsFetches:   map[string]*limitsFetch{},
	}
	if p.productRef == "" {
		p.productRef = os.Getenv("SOLVAPAY_PRODUCT_REF")
	}
	if p.ttl == 0 {
		p.ttl = DefaultLimitsCacheTTL
	}
	if p.now == nil {
		p.now = time.Now
	}
	if p.logger == nil {
		p.logger = slog.Default()
	}
	return p, nil
}

// flight is one call that concurrent callers share (singleflight).
type flight[T any] struct {
	done  chan struct{}
	value T
	err   error
}

type limitsEntry struct {
	remaining float64
	at        time.Time
	limits    map[string]any
}

// limitsFetch is one limits check shared by every caller that arrives while
// it is in flight; each claims a distinct unit, in order of arrival.
type limitsFetch struct {
	flight[map[string]any]
	claimed int
}

// FreeLimit is a free allowance the platform meters: Cap calls per Scope
// ("rolling_window", which needs WindowDays, or "lifetime"). Meter must match
// free-[a-z0-9-]+; empty means "free-requests".
type FreeLimit struct {
	Meter      string
	Cap        int
	Scope      string
	WindowDays int
}

var freeMeterPattern = regexp.MustCompile(`^free-[a-z0-9-]+$`)

// normalised is the limit with its meter lowercased, or invalid_free_limit.
func (f FreeLimit) normalised() (FreeLimit, error) {
	if f.Meter == "" {
		f.Meter = "free-requests"
	}
	f.Meter = strings.ToLower(f.Meter)
	switch {
	case !freeMeterPattern.MatchString(f.Meter):
		return f, newError("invalid_free_limit", fmt.Sprintf("Free meter %q must match %s", f.Meter, freeMeterPattern))
	case f.Cap <= 0:
		return f, newError("invalid_free_limit", "A free limit's cap must be above 0")
	case f.Scope != "rolling_window" && f.Scope != "lifetime":
		return f, newError("invalid_free_limit", fmt.Sprintf("A free limit's scope must be rolling_window or lifetime, not %q", f.Scope))
	case f.Scope == "rolling_window" && f.WindowDays <= 0:
		return f, newError("invalid_free_limit", "A rolling_window free limit needs WindowDays")
	}
	return f, nil
}

func (f FreeLimit) wire() map[string]any {
	out := map[string]any{"meter": f.Meter, "cap": f.Cap, "scope": f.Scope}
	if f.WindowDays != 0 {
		out["windowDays"] = f.WindowDays
	}
	return out
}

// DecideParams is one paid call to decide.
type DecideParams struct {
	// CustomerRef is a SolvaPay customer (cus_…), your own user id (mapped to
	// a customer, created on first use), or "anonymous".
	CustomerRef string
	// Product; empty means the Paywall's ProductRef.
	Product   string
	Meter     string
	FreeLimit *FreeLimit
	ToolName  string
}

// Outcome is a paywall verdict.
type Outcome string

const (
	OutcomeAllow Outcome = "allow"
	OutcomeGate  Outcome = "gate"
)

// Decision is the paywall's verdict on one paid call. Allow: run the handler
// (RunAllow records its usage). Gate: return Gate to the caller instead.
type Decision struct {
	Outcome     Outcome
	CustomerRef string
	RequestID   string
	Limits      map[string]any
	Gate        map[string]any
	// Consequence is "overage" when the call is allowed past the included cap.
	Consequence string
}

// Allowed reports whether the handler may run.
func (d Decision) Allowed() bool { return d.Outcome == OutcomeAllow }

// PaywallError is a paid call that was gated. Gate is the paywall to show the
// customer. It unwraps to an *Error whose Code is the gate's kind.
type PaywallError struct {
	Gate map[string]any
	err  *Error
}

// NewPaywallError is the error a handler returns to gate its own call.
func NewPaywallError(gate map[string]any) *PaywallError {
	message := "Payment required"
	if text, ok := gate["message"].(string); ok && text != "" {
		message = text
	}
	return &PaywallError{Gate: gate, err: &Error{Code: jsString(gate["kind"]), Message: message, Status: 402}}
}

func (e *PaywallError) Error() string { return e.err.Error() }
func (e *PaywallError) Unwrap() error { return e.err }

const requestIDAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

func (p *Paywall) requestID() string {
	random := make([]byte, 9)
	limit := big.NewInt(int64(len(requestIDAlphabet)))
	for i := range random {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			panic("solvapay: crypto/rand failed: " + err.Error())
		}
		random[i] = requestIDAlphabet[n.Int64()]
	}
	return fmt.Sprintf("solvapay_%d_%s", p.now().UnixMilli(), random)
}

func (p *Paywall) requireProduct(product string) (string, error) {
	if product == "" {
		product = p.productRef
	}
	if product == "" {
		return "", newError("missing_product", "No product: pass a product or set SOLVAPAY_PRODUCT_REF.")
	}
	return product, nil
}

// Customers ---------------------------------------------------------------

// EnsureCustomerOptions are optional details for a customer created on first use.
type EnsureCustomerOptions struct {
	// ExternalRef is your own user id: the customer is looked up by it first
	// and created with it.
	ExternalRef string
	Email       string
	Name        string
}

// EnsureCustomer is the SolvaPay customer (cus_…) for your user, created on
// first use. A cus_ ref and "anonymous" are returned as they are. Concurrent
// calls for one user share one lookup.
func (p *Paywall) EnsureCustomer(ctx context.Context, customerRef string, options EnsureCustomerOptions) (string, error) {
	if customerRef == "anonymous" || strings.HasPrefix(customerRef, "cus_") {
		return customerRef, nil
	}
	key := options.ExternalRef
	if key == "" {
		key = customerRef
	}
	p.mu.Lock()
	if ref, ok := p.customers[customerRef]; ok {
		p.mu.Unlock()
		return ref, nil
	}
	pending, joined := p.customerLookups[key]
	if !joined {
		pending = &flight[string]{done: make(chan struct{})}
		p.customerLookups[key] = pending
	}
	p.mu.Unlock()

	if !joined {
		// The lookup is shared, so one caller leaving must not cancel it for the rest.
		pending.value, pending.err = p.resolveCustomer(context.WithoutCancel(ctx), customerRef, options)
		p.mu.Lock()
		delete(p.customerLookups, key)
		p.mu.Unlock()
		close(pending.done)
	}
	select {
	case <-pending.done:
	case <-ctx.Done():
		return "", &Error{Code: "network_error", Message: ctx.Err().Error()}
	}
	if pending.err != nil {
		return "", pending.err
	}
	p.mu.Lock()
	p.customers[customerRef] = pending.value
	p.mu.Unlock()
	return pending.value, nil
}

func (p *Paywall) findByExternalRef(ctx context.Context, externalRef string) (string, error) {
	customer, err := p.client.GetCustomerByExternalRef(ctx, externalRef)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.Status == 404 {
			return "", nil
		}
		return "", err
	}
	return customer.Reference, nil
}

func (p *Paywall) resolveCustomer(ctx context.Context, customerRef string, options EnsureCustomerOptions) (string, error) {
	if options.ExternalRef != "" {
		found, err := p.findByExternalRef(ctx, options.ExternalRef)
		if err != nil || found != "" {
			return found, err
		}
	}
	email := options.Email
	if email == "" {
		email = fmt.Sprintf("%s-%d@auto-created.local", customerRef, p.now().UnixMilli())
	}
	body := map[string]any{"email": email, "metadata": map[string]any{}}
	if options.Name != "" {
		body["name"] = options.Name
	}
	if options.ExternalRef != "" {
		body["externalRef"] = options.ExternalRef
	}
	created, err := p.client.CreateCustomer(ctx, body)
	if err == nil {
		return created.Reference, nil
	}
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 409 {
		return "", err
	}
	if options.ExternalRef != "" {
		found, lookupErr := p.findByExternalRef(ctx, options.ExternalRef)
		if lookupErr != nil || found != "" {
			return found, lookupErr
		}
	}
	return "", &Error{
		Code:    "customer_conflict",
		Status:  409,
		Message: fmt.Sprintf("A customer for %s already exists and is not linked to it: %s. Link the existing customer to this externalRef.", customerRef, apiErr.Message),
		Body:    apiErr.Body,
	}
}

// Limits ------------------------------------------------------------------

// InvalidateLimits drops cached limits for a customer: for every product, or
// only for product when it is not empty. customerRef may be a cus_ ref, the
// same ref without its prefix, or your own user id.
func (p *Paywall) InvalidateLimits(customerRef, product string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	aliases := map[string]bool{customerRef: true}
	if mapped, ok := p.customers[customerRef]; ok {
		aliases[mapped] = true
	}
	if !strings.HasPrefix(customerRef, "cus_") {
		aliases["cus_"+customerRef] = true
	}
	for key := range p.limits {
		ref, rest, _ := strings.Cut(key, ":")
		keyProduct, _, _ := strings.Cut(rest, ":")
		if aliases[ref] && (product == "" || keyProduct == product) {
			delete(p.limits, key)
		}
	}
}

// claimLimits answers whether this caller may use a unit, from the cache or
// one limits check shared with every caller that arrives while it runs.
func (p *Paywall) claimLimits(ctx context.Context, key string, body map[string]any) (map[string]any, bool, error) {
	p.mu.Lock()
	if cached, ok := p.limits[key]; ok && p.now().Sub(cached.at) < p.ttl {
		defer p.mu.Unlock()
		if cached.remaining > 0 {
			cached.remaining--
			if cached.remaining <= 0 {
				delete(p.limits, key)
			}
			return cached.limits, true, nil
		}
		// The last unit was used: block one call from the cache, then re-check.
		delete(p.limits, key)
		return cached.limits, false, nil
	}
	delete(p.limits, key)
	fetch, joined := p.limitsFetches[key]
	if !joined {
		fetch = &limitsFetch{flight: flight[map[string]any]{done: make(chan struct{})}}
		p.limitsFetches[key] = fetch
	}
	fetch.claimed++
	ticket := fetch.claimed
	p.mu.Unlock()

	if !joined {
		limits, err := p.client.CheckLimits(context.WithoutCancel(ctx), body)
		p.mu.Lock()
		fetch.value, fetch.err = limits, err
		delete(p.limitsFetches, key)
		// Every caller that shared this check has its ticket; the units they
		// did not claim are counted down from the cache.
		if err == nil && limits["withinLimits"] == true {
			if remaining := limits["remaining"].(float64); remaining > 0 {
				p.limits[key] = &limitsEntry{remaining: max(remaining-float64(fetch.claimed), 0), at: p.now(), limits: limits}
			}
		}
		p.mu.Unlock()
		close(fetch.done)
	}
	select {
	case <-fetch.done:
	case <-ctx.Done():
		return nil, false, &Error{Code: "network_error", Message: ctx.Err().Error()}
	}
	if fetch.err != nil {
		return nil, false, fetch.err
	}
	limits := fetch.value
	remaining := limits["remaining"].(float64)
	switch {
	case limits["withinLimits"] != true:
		return limits, false, nil
	case remaining == -1:
		return limits, true, nil
	case remaining > 0:
		// Callers sharing one check each claim a distinct unit.
		return limits, float64(ticket) <= remaining, nil
	default:
		// withinLimits with nothing remaining is overage: the API allows it.
		return limits, true, nil
	}
}

func meterOf(meter string, freeLimit *FreeLimit) string {
	if freeLimit != nil && freeLimit.Meter != "" {
		return freeLimit.Meter
	}
	if meter != "" {
		return meter
	}
	return "requests"
}

func freeMeterName(freeLimit *FreeLimit) string {
	if freeLimit == nil {
		return ""
	}
	return freeLimit.Meter
}

func actionOf(limits map[string]any, usageType string) string {
	if name := jsGet(limits, "meterName"); jsTruthy(name) {
		return jsString(name)
	}
	return usageType
}

// Decide answers allow or gate for one paid call. A gate records a paywall
// usage event; an allow records nothing until RunAllow has run the handler.
func (p *Paywall) Decide(ctx context.Context, params DecideParams) (Decision, error) {
	product, err := p.requireProduct(params.Product)
	if err != nil {
		return Decision{}, err
	}
	var freeLimit *FreeLimit
	if params.FreeLimit != nil {
		normalised, err := params.FreeLimit.normalised()
		if err != nil {
			return Decision{}, err
		}
		freeLimit = &normalised
	}
	usageType := meterOf(params.Meter, freeLimit)
	requestID := p.requestID()
	started := p.now()

	if trimmed := strings.TrimSpace(params.CustomerRef); freeLimit != nil && (trimmed == "" || trimmed == "anonymous") {
		return Decision{}, &Error{Code: "identity_required", Status: 401, Message: "identity required"}
	}

	backendRef, err := p.EnsureCustomer(ctx, params.CustomerRef, EnsureCustomerOptions{ExternalRef: params.CustomerRef})
	if err != nil {
		return Decision{}, err
	}
	key := backendRef + ":" + product + ":" + usageType
	body := map[string]any{
		"customerRef":            backendRef,
		"productRef":             product,
		"meterName":              usageType,
		"includeCheckoutSession": true,
	}
	if freeLimit != nil {
		body["freeAllowance"] = freeLimit.wire()
	}
	limits, within, err := p.claimLimits(ctx, key, body)
	if err != nil {
		return Decision{}, err
	}

	if !within {
		p.TrackUsage(ctx, UsageEvent{
			CustomerRef: backendRef,
			Product:     product,
			Action:      actionOf(limits, usageType),
			Outcome:     "paywall",
			RequestID:   requestID,
			Duration:    p.now().Sub(started),
			ToolName:    params.ToolName,
			MeterName:   freeMeterName(freeLimit),
		})
		// Gating on our own count (the last cached unit is used, or more
		// parallel callers than units shared one check): the limits we counted
		// down from still say units remain. The gate says none do.
		gateLimits := limits
		if jsTruthy(limits["withinLimits"]) {
			gateLimits = copyJSON(limits)
			gateLimits["withinLimits"] = false
			gateLimits["remaining"] = float64(0)
		}
		return Decision{
			Outcome:     OutcomeGate,
			CustomerRef: backendRef,
			RequestID:   requestID,
			Limits:      limits,
			Gate:        BuildPaywallGate(product, gateLimits),
		}, nil
	}
	decision := Decision{Outcome: OutcomeAllow, CustomerRef: backendRef, RequestID: requestID, Limits: limits}
	if jsTruthy(jsGet(limits, "overage")) {
		decision.Consequence = "overage"
	}
	return decision, nil
}

// RunParams says what an allowed call was for; it must match the DecideParams.
type RunParams struct {
	Product   string
	Meter     string
	FreeLimit *FreeLimit
	ToolName  string
}

// RunAllow runs handler for an allow decision and records success or fail.
// A *PaywallError from the handler (it gated the call itself) is returned
// without recording anything. A handler that panics is recorded as fail and
// the panic continues.
func (p *Paywall) RunAllow(ctx context.Context, decision Decision, params RunParams, handler func(context.Context) error) (err error) {
	if !decision.Allowed() {
		return newError("invalid_argument", "RunAllow needs an allow decision")
	}
	product, err := p.requireProduct(params.Product)
	if err != nil {
		return err
	}
	freeLimit := params.FreeLimit
	if freeLimit != nil {
		normalised, err := freeLimit.normalised()
		if err != nil {
			return err
		}
		freeLimit = &normalised
	}
	event := UsageEvent{
		CustomerRef: decision.CustomerRef,
		Product:     product,
		Action:      actionOf(decision.Limits, meterOf(params.Meter, freeLimit)),
		RequestID:   decision.RequestID,
		ToolName:    params.ToolName,
		MeterName:   freeMeterName(freeLimit),
	}
	started := p.now()
	finished := false
	defer func() {
		if finished {
			return
		}
		recovered := recover()
		if recovered == nil {
			return // runtime.Goexit: not a failure of the call
		}
		event.Outcome = "fail"
		event.Duration = p.now().Sub(started)
		p.TrackUsage(ctx, event)
		panic(recovered)
	}()
	err = handler(ctx)
	finished = true
	event.Duration = p.now().Sub(started)
	if err != nil {
		var gated *PaywallError
		if errors.As(err, &gated) {
			return err
		}
		event.Outcome = "fail"
		p.TrackUsage(ctx, event)
		return err
	}
	event.Outcome = "success"
	if freeLimit == nil {
		event.UsageClass = "included"
		if decision.Consequence == "overage" {
			event.UsageClass = "overage"
		}
	}
	p.TrackUsage(ctx, event)
	return nil
}

// Usage -------------------------------------------------------------------

// UsageEvent is one paid call's outcome, as the paywall records it.
type UsageEvent struct {
	CustomerRef string
	Product     string
	Action      string
	// Outcome is "success", "paywall" or "fail".
	Outcome   string
	RequestID string
	Duration  time.Duration
	ToolName  string
	// MeterName is the free meter, for a call under a free allowance.
	MeterName string
	// UsageClass is "included" or "overage", for a successful paid call.
	UsageClass string
}

// TrackUsage records one usage event. A failure is logged instead of failing
// the paid call. The event is keyed "{RequestID}:{Outcome}", so a retry never
// counts twice; a 404 (a customer created moments ago and not yet visible) is
// retried twice.
func (p *Paywall) TrackUsage(ctx context.Context, event UsageEvent) {
	action := event.Action
	if action == "" {
		action = "api_requests"
	}
	metadata := map[string]any{"action": action, "requestId": event.RequestID}
	if event.ToolName != "" {
		metadata["toolName"] = event.ToolName
	}
	if event.MeterName != "" {
		metadata["meterName"] = event.MeterName
	}
	if event.UsageClass != "" {
		metadata["usageClass"] = event.UsageClass
	}
	body := map[string]any{
		"customerRef":    event.CustomerRef,
		"actionType":     "api_call",
		"units":          1,
		"outcome":        event.Outcome,
		"productRef":     event.Product,
		"duration":       event.Duration.Milliseconds(),
		"idempotencyKey": event.RequestID + ":" + event.Outcome,
		"metadata":       metadata,
		"timestamp":      p.now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	for attempt := 0; ; attempt++ {
		err := p.client.RecordUsage(ctx, body)
		if err == nil {
			return
		}
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.Status == 404 && attempt < 2 {
			if sleep(ctx, usageRetryDelay) == nil {
				continue
			}
		}
		p.logger.Error("SolvaPay usage tracking failed",
			"customerRef", event.CustomerRef, "outcome", event.Outcome, "error", err, "code", ErrorCode(err))
		return
	}
}
