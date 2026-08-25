package mcp

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
)

type mockBackend struct {
	limits      map[string]any
	mu          sync.Mutex
	trackBodies []map[string]any
}

func newMockBackend(limits map[string]any) *mockBackend {
	return &mockBackend{limits: limits}
}

func (m *mockBackend) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_ = json.NewEncoder(w).Encode(m.limits)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			body, _ := io.ReadAll(r.Body)
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			m.mu.Lock()
			m.trackBodies = append(m.trackBodies, payload)
			m.mu.Unlock()
			_, _ = w.Write([]byte(`{"reference":"usg_test","outcome":"success"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			ext := r.URL.Query().Get("externalRef")
			ref := backendRef(ext)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"reference":   ref,
				"email":       "a@example.com",
				"externalRef": ext,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/customers":
			_, _ = w.Write([]byte(`{"reference":"cus_created","email":"created@example.com"}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func backendRef(identity string) string {
	if len(identity) >= 4 && identity[:4] == "cus_" {
		return identity
	}
	if identity == "" {
		return "cus_anonymous"
	}
	return "cus_" + identity
}

func projectUsage(calls []map[string]any) ([]map[string]any, error) {
	projected := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		meta, _ := call["metadata"].(map[string]any)
		if meta == nil {
			meta = map[string]any{}
		}
		if _, ok := call["duration"]; !ok {
			return nil, fmt.Errorf("trackUsage call missing duration")
		}
		if _, ok := call["timestamp"]; !ok {
			return nil, fmt.Errorf("trackUsage call missing timestamp")
		}
		if _, ok := meta["requestId"]; !ok {
			return nil, fmt.Errorf("trackUsage call missing metadata.requestId")
		}
		projected = append(projected, map[string]any{
			"outcome":     call["outcome"],
			"actionType":  call["actionType"],
			"units":       call["units"],
			"productRef":  call["productRef"],
			"customerRef": call["customerRef"],
			"metadata":    map[string]any{"action": meta["action"]},
		})
	}
	return projected, nil
}

func (m *mockBackend) usage() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]any, len(m.trackBodies))
	copy(out, m.trackBodies)
	return out
}
