package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The guest tells JSON bodies from text ones by Content-Type, so the host
// transport must carry the header across the wire protocol.
func TestPerformRequestForwardsContentType(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(backend.Close)

	reqJSON, err := json.Marshal(wireRequest{Method: http.MethodGet, URL: backend.URL})
	if err != nil {
		t.Fatal(err)
	}
	respJSON, err := performRequest(context.Background(), reqJSON)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Status      uint16 `json:"status"`
		Body        string `json:"body"`
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal(respJSON, &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != http.StatusOK || got.Body != `{"ok":true}` {
		t.Fatalf("unexpected response: %+v", got)
	}
	if got.ContentType != "application/json; charset=utf-8" {
		t.Fatalf("contentType = %q, want the backend's Content-Type", got.ContentType)
	}
}

// A backend that sends no Content-Type leaves the field off the wire.
func TestPerformRequestOmitsAbsentContentType(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header()["Content-Type"] = nil
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(backend.Close)

	reqJSON, err := json.Marshal(wireRequest{Method: http.MethodDelete, URL: backend.URL})
	if err != nil {
		t.Fatal(err)
	}
	respJSON, err := performRequest(context.Background(), reqJSON)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(respJSON, &raw); err != nil {
		t.Fatal(err)
	}
	if _, present := raw["contentType"]; present {
		t.Fatalf("contentType must be omitted, got %v", raw["contentType"])
	}
}
