package solvapay

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"time"
)

func (c *Client) ensureCustomer(ctx context.Context, customerRef string) (string, error) {
	c.gate.mu.Lock()
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

	ref, err := c.runEnsureCustomer(ctx, customerRef)
	inf.ref, inf.err = ref, err
	c.gate.mu.Lock()
	delete(c.gate.customerInflight, customerRef)
	c.gate.mu.Unlock()
	close(inf.done)
	return ref, err
}

type ensureCustomerIO struct {
	client *Client
}

func (h ensureCustomerIO) NowMs() int64 {
	return time.Now().UnixMilli()
}

func (h ensureCustomerIO) ReadCustomerCache(key string) (EnsureCustomerCacheHit, bool) {
	h.client.gate.mu.Lock()
	entry, ok := h.client.gate.customerCache[key]
	h.client.gate.mu.Unlock()
	if !ok {
		return EnsureCustomerCacheHit{}, false
	}
	return EnsureCustomerCacheHit{Found: true, BackendRef: entry.value, TimestampMs: entry.timestampMs}, true
}

func (h ensureCustomerIO) GetCustomer(ctx context.Context, byExternalRef, byEmail string) (EnsureCustomerLookup, error) {
	params := map[string]any{}
	if byExternalRef != "" {
		params["externalRef"] = byExternalRef
	} else if byEmail != "" {
		params["email"] = byEmail
	}
	existing, err := h.client.GetCustomer(ctx, params)
	if err != nil {
		return EnsureCustomerLookup{ErrorMessage: err.Error()}, nil
	}
	obj := asObject(existing)
	ref, _ := obj["customerRef"].(string)
	if ref == "" {
		return EnsureCustomerLookup{}, nil
	}
	return EnsureCustomerLookup{Found: true, Customer: obj}, nil
}

func (h ensureCustomerIO) CreateCustomer(ctx context.Context, params map[string]any) (EnsureCustomerCreate, error) {
	created, err := h.client.CreateCustomer(ctx, params)
	if err != nil {
		return EnsureCustomerCreate{ErrorMessage: err.Error()}, nil
	}
	return EnsureCustomerCreate{OK: true, Customer: asObject(created)}, nil
}

func (h ensureCustomerIO) UpdateCustomer(ctx context.Context, customerRef string, patch map[string]any) (EnsureCustomerUpdate, error) {
	_, err := h.client.UpdateCustomer(ctx, customerRef, patch)
	if err != nil {
		return EnsureCustomerUpdate{ErrorMessage: err.Error()}, nil
	}
	return EnsureCustomerUpdate{OK: true}, nil
}

func (h ensureCustomerIO) WriteCustomerCache(key, backendRef string, timestampMs int64) {
	h.client.gate.mu.Lock()
	storeCustomerCache(h.client.gate.customerCache, key, customerCacheEntry{
		value:       backendRef,
		timestampMs: timestampMs,
	})
	h.client.gate.mu.Unlock()
}

func (c *Client) runEnsureCustomer(ctx context.Context, customerRef string) (string, error) {
	event := map[string]any{
		"kind":              "start",
		"customerRef":       customerRef,
		"canCreateCustomer": clientHasMethod(c, "CreateCustomer"),
		"canUpdateCustomer": clientHasMethod(c, "UpdateCustomer"),
		"dedupTTLMs":        CustomerDedupTTLMs,
		"nowMs":             time.Now().UnixMilli(),
	}
	return RunGeneratedEnsureCustomerLoop(ctx, func(state any, step map[string]any) (any, map[string]any, error) {
		outJSON, err := callDecisionJSON(ctx, "sv_ensure_customer_next_binding", map[string]any{
			"state": state,
			"event": step,
		})
		if err != nil {
			return nil, nil, err
		}
		var out map[string]any
		if err := json.Unmarshal(outJSON, &out); err != nil {
			return nil, nil, fmt.Errorf("solvapay: ensure_customer_next: %w", err)
		}
		if _, hasAction := out["action"]; !hasAction {
			details, _ := out["details"].(string)
			if details == "" {
				details, _ = out["error"].(string)
			}
			if details == "" {
				details = "ensure_customer_next failed"
			}
			return nil, nil, &Error{Code: "internal_error", Message: details}
		}
		return out["state"], asObject(out["action"]), nil
	}, ensureCustomerIO{c}, event)
}

func clientHasMethod(client *Client, name string) bool {
	method := reflect.ValueOf(client).MethodByName(name)
	return method.IsValid() && method.Kind() == reflect.Func
}

func storeCustomerCache(cache map[string]customerCacheEntry, key string, entry customerCacheEntry) {
	cache[key] = entry
	overflow := len(cache) - CustomerDedupMaxCacheSize
	if overflow <= 0 {
		return
	}
	type keyed struct {
		key string
		ts  int64
	}
	ordered := make([]keyed, 0, len(cache))
	for cacheKey, cached := range cache {
		ordered = append(ordered, keyed{key: cacheKey, ts: cached.timestampMs})
	}
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].ts < ordered[j].ts
	})
	for i := 0; i < overflow; i++ {
		delete(cache, ordered[i].key)
	}
}
