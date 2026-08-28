package mcp

import (
	"encoding/json"
	"net/http"
	"strings"
)

func pathOnly(path string) string {
	if i := strings.IndexByte(path, '?'); i >= 0 {
		return path[:i]
	}
	return path
}

func writeOAuth(w http.ResponseWriter, envelope any) {
	env := asMap(envelope)
	status := asInt(env["status"], 500)
	for k, v := range asStringMap(env["headers"]) {
		w.Header().Set(k, v)
	}
	writeJSON(w, status, env["body"])
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	if body == nil {
		w.WriteHeader(status)
		return
	}
	if _, ok := w.Header()["Content-Type"]; !ok {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		if m == nil {
			return map[string]any{}
		}
		return m
	}
	return map[string]any{}
}

func asStringMap(v any) map[string]string {
	out := map[string]string{}
	for k, val := range asMap(v) {
		if s, ok := val.(string); ok {
			out[k] = s
		}
	}
	return out
}

func asString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func asInt(v any, fallback int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return fallback
	}
}
