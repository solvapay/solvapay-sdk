// Package livecontract provides pure helpers for the Go live-contract driver (Step 51).
//
// Mirrors Python/Ruby/Rust live_contract helpers: scenario table, placeholder
// resolution, volatile-key normalization, and structured-error scoring.
package livecontract

import (
	"strings"
)

// VOLATILE_KEYS are stripped during Normalize (Python/Ruby/Rust parity).
var VOLATILE_KEYS = map[string]struct{}{
	"id":             {},
	"reference":      {},
	"createdAt":      {},
	"updatedAt":      {},
	"created":        {},
	"updated":        {},
	"idempotencyKey": {},
	"clientSecret":   {},
	"secret":         {},
	"token":          {},
	"url":            {},
	"checkoutUrl":    {},
	"sessionUrl":     {},
}

// VOLATILE_SUFFIXES mark volatile fields (Python/Ruby/Rust parity).
var VOLATILE_SUFFIXES = []string{"At", "Url", "Ref", "Id", "Secret", "Token"}

// ResolveArgs recursively substitutes {key} placeholders from refs into a JSON-like value.
func ResolveArgs(template any, refs map[string]string) any {
	switch v := template.(type) {
	case string:
		out := v
		for key, replacement := range refs {
			out = strings.ReplaceAll(out, "{"+key+"}", replacement)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = ResolveArgs(item, refs)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, child := range v {
			out[key] = ResolveArgs(child, refs)
		}
		return out
	default:
		return template
	}
}

// ExtractRef pulls the first non-empty string for any of keys, including nested
// product / plan / customer objects.
func ExtractRef(value any, keys []string) string {
	m, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range keys {
		if candidate, ok := m[key].(string); ok && candidate != "" {
			return candidate
		}
	}
	for _, nest := range []string{"product", "plan", "customer"} {
		if found := ExtractRef(m[nest], keys); found != "" {
			return found
		}
	}
	return ""
}

// Normalize strips volatile keys/suffixes and drops nulls.
func Normalize(value any) any {
	switch v := value.(type) {
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = Normalize(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any)
		for key, child := range v {
			if _, volatile := VOLATILE_KEYS[key]; volatile {
				continue
			}
			if hasVolatileSuffix(key) {
				continue
			}
			if child == nil {
				continue
			}
			out[key] = Normalize(child)
		}
		return out
	default:
		return value
	}
}

func hasVolatileSuffix(key string) bool {
	for _, suffix := range VOLATILE_SUFFIXES {
		if strings.HasSuffix(key, suffix) {
			return true
		}
	}
	return false
}

// IsStructuredError reports whether the client returned a structured SDK error observation.
func IsStructuredError(outcome map[string]any) bool {
	v, present := outcome["ok"]
	if !present || v != false {
		return false
	}
	errorObj, ok := outcome["error"].(map[string]any)
	if !ok {
		return false
	}
	message, ok := errorObj["message"].(string)
	return ok && message != ""
}

// ScoreScenario returns IDENTICAL or DIVERGED for one live scenario.
//
// Success-path scenarios must return ok. Intentional error probes
// (ExpectError) must return a structured SDK error.
func ScoreScenario(scenario Scenario, outcome map[string]any) string {
	if scenario.ExpectError {
		if IsStructuredError(outcome) {
			return "IDENTICAL"
		}
		return "DIVERGED"
	}
	if outcome["ok"] == true {
		return "IDENTICAL"
	}
	return "DIVERGED"
}

// OkOutcome builds a success observation.
func OkOutcome(value any) map[string]any {
	return map[string]any{"ok": true, "value": value}
}

// ErrOutcome builds an error observation from a map shaped like {name,message,status,code}.
func ErrOutcome(errorObj map[string]any) map[string]any {
	return map[string]any{"ok": false, "error": errorObj}
}
