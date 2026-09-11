package solvapay

import (
	"context"
	"encoding/json"
	"fmt"
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

func (c *Client) runEnsureCustomer(ctx context.Context, customerRef string) (string, error) {
	var state any
	event := map[string]any{
		"kind":              "start",
		"customerRef":       customerRef,
		"canCreateCustomer": true,
		"canUpdateCustomer": true,
		"nowMs":             time.Now().UnixMilli(),
	}
	for {
		outJSON, err := callDecisionJSON(ctx, "sv_ensure_customer_next_binding", map[string]any{
			"state": state,
			"event": event,
		})
		if err != nil {
			return "", err
		}
		var out map[string]any
		if err := json.Unmarshal(outJSON, &out); err != nil {
			return "", fmt.Errorf("solvapay: ensure_customer_next: %w", err)
		}
		if _, hasAction := out["action"]; !hasAction {
			details, _ := out["details"].(string)
			if details == "" {
				details, _ = out["error"].(string)
			}
			if details == "" {
				details = "ensure_customer_next failed"
			}
			return "", &Error{Code: "internal_error", Message: details}
		}
		state = out["state"]
		action := asObject(out["action"])
		switch action["kind"] {
		case "readCustomerCache":
			key, _ := action["key"].(string)
			c.gate.mu.Lock()
			entry, ok := c.gate.customerCache[key]
			c.gate.mu.Unlock()
			if ok {
				event = map[string]any{
					"kind":        "customerCacheEntry",
					"found":       true,
					"backendRef":  entry.value,
					"timestampMs": entry.timestampMs,
					"nowMs":       time.Now().UnixMilli(),
				}
			} else {
				event = map[string]any{
					"kind":  "customerCacheEntry",
					"found": false,
					"nowMs": time.Now().UnixMilli(),
				}
			}
		case "getCustomer":
			params := map[string]any{}
			if ref, ok := action["byExternalRef"].(string); ok && ref != "" {
				params["externalRef"] = ref
			} else if email, ok := action["byEmail"].(string); ok && email != "" {
				params["email"] = email
			}
			existing, err := c.GetCustomer(ctx, params)
			if err != nil {
				event = map[string]any{
					"kind":         "customerLookupResult",
					"found":        false,
					"errorMessage": err.Error(),
					"nowMs":        time.Now().UnixMilli(),
				}
				continue
			}
			obj := asObject(existing)
			ref, _ := obj["customerRef"].(string)
			if ref == "" {
				event = map[string]any{
					"kind":  "customerLookupResult",
					"found": false,
					"nowMs": time.Now().UnixMilli(),
				}
				continue
			}
			event = map[string]any{
				"kind":     "customerLookupResult",
				"found":    true,
				"customer": obj,
				"nowMs":    time.Now().UnixMilli(),
			}
		case "createCustomer":
			params := asObject(action["params"])
			created, err := c.CreateCustomer(ctx, params)
			if err != nil {
				event = map[string]any{
					"kind":         "customerCreateResult",
					"ok":           false,
					"errorMessage": err.Error(),
					"nowMs":        time.Now().UnixMilli(),
				}
				continue
			}
			event = map[string]any{
				"kind":     "customerCreateResult",
				"ok":       true,
				"customer": asObject(created),
				"nowMs":    time.Now().UnixMilli(),
			}
		case "updateCustomer":
			ref, _ := action["customerRef"].(string)
			_, err := c.UpdateCustomer(ctx, ref, asObject(action["patch"]))
			event = map[string]any{
				"kind":  "customerUpdateResult",
				"ok":    err == nil,
				"nowMs": time.Now().UnixMilli(),
			}
			if err != nil {
				event["errorMessage"] = err.Error()
			}
		case "resolved":
			backend, _ := action["backendRef"].(string)
			if backend == "" {
				return "", &Error{Code: "internal_error", Message: "ensure_customer_next resolved without backendRef"}
			}
			if cache := asObject(action["cache"]); cache["key"] != nil {
				key, _ := cache["key"].(string)
				c.gate.mu.Lock()
				storeCustomerCache(c.gate.customerCache, key, customerCacheEntry{
					value:       backend,
					timestampMs: int64(asFloat(cache["timestampMs"])),
				})
				c.gate.mu.Unlock()
			}
			return backend, nil
		default:
			return "", &Error{Code: "internal_error", Message: "ensure_customer_next returned unknown action kind"}
		}
	}
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
