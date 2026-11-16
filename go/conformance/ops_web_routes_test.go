package conformance

// Suite web-routes (webRoute): the HTTP routes the @solvapay/react components
// call, served by solvapay.NewWebHandler, as
// conformance/runners/typescript/src/web-routes.ts drives TypeScript's
// solvapayRoutes(). The case's user is what the merchant's GetUser hook
// answers (nil for user: null); SolvaPay's API answers from the case's api
// list, each exchange once, by method and path in the order listed.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go"
)

const webAppOrigin = "https://app.conformance.test"

func init() {
	register("webRoute", webRoute)
}

// webExchange is one scripted answer, with its body as the case file writes
// it: TypeScript sends JSON.stringify of the parsed case, which keeps key
// order, and an error message quotes that text, so Go must send the same bytes.
type webExchange struct {
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// webExchanges reads the running case's api list from its file, in order.
func webExchanges(t *testing.T) []webExchange {
	t.Helper()
	where := strings.TrimPrefix(t.Name(), "TestConformance/")
	raw, err := os.ReadFile(filepath.Join(casesDir, filepath.FromSlash(where)))
	if err != nil {
		t.Fatalf("reading the case for its api answers: %v", err)
	}
	var file struct {
		Input struct {
			Args struct {
				API []webExchange `json:"api"`
			} `json:"args"`
		} `json:"input"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Input.Args.API
}

type webAPI struct {
	t       *testing.T
	mu      sync.Mutex
	pending []webExchange
	calls   []any
}

func (a *webAPI) RoundTrip(r *http.Request) (*http.Response, error) {
	call := map[string]any{"method": r.Method, "path": r.URL.Path}
	if r.URL.RawQuery != "" {
		call["query"] = r.URL.RawQuery
	}
	if r.Body != nil {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		if len(body) > 0 {
			parsed, err := decodeJSON(body)
			if err != nil {
				a.t.Errorf("request body is not JSON: %s", body)
				return nil, err
			}
			call["body"] = parsed
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, call)
	for i, exchange := range a.pending {
		if exchange.Method != r.Method || exchange.Path != r.URL.Path {
			continue
		}
		a.pending = append(a.pending[:i:i], a.pending[i+1:]...)
		content := []byte{}
		if len(exchange.Body) > 0 {
			var compact bytes.Buffer
			if err := json.Compact(&compact, exchange.Body); err != nil {
				return nil, err
			}
			content = compact.Bytes()
		}
		status := exchange.Status
		if status == 0 {
			status = 200
		}
		return &http.Response{
			StatusCode: status,
			Header:     http.Header{"Content-Type": {"application/json"}},
			Body:       io.NopCloser(bytes.NewReader(content)),
			Request:    r,
		}, nil
	}
	a.t.Errorf("Unexpected API call: %s %s", r.Method, r.URL.Path)
	return nil, fmt.Errorf("unexpected API call: %s %s", r.Method, r.URL.Path)
}

func webParsed(text []byte) (any, error) {
	if len(text) == 0 {
		return nil, nil
	}
	if parsed, err := decodeJSON(text); err == nil {
		return parsed, nil
	}
	return string(text), nil
}

func webRoute(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := &webAPI{t: t, pending: webExchanges(t)}
	retries := 0 // TypeScript never retries
	client, err := solvapay.NewClient(solvapay.Config{
		APIKey:     "sk_sandbox_conformance",
		APIBaseURL: mcpConformanceAPI,
		MaxRetries: &retries,
		HTTPClient: &http.Client{Transport: api},
	})
	if err != nil {
		t.Fatal(err)
	}
	var user *solvapay.WebUser
	if given, ok := args["user"].(map[string]any); ok {
		user = &solvapay.WebUser{}
		user.ID, _ = given["id"].(string)
		user.Email, _ = given["email"].(string)
		user.Name, _ = given["name"].(string)
	}
	handler, err := solvapay.NewWebHandler(solvapay.WebOptions{
		Client:  client,
		GetUser: func(*http.Request) (*solvapay.WebUser, error) { return user, nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	method, _ := args["method"].(string)
	if method == "" {
		method = http.MethodGet
	}
	target := webAppOrigin + args["path"].(string)
	if query, ok := args["query"].(map[string]any); ok {
		values := url.Values{}
		for key, value := range query {
			values.Set(key, value.(string))
		}
		target += "?" + values.Encode()
	}
	var body io.Reader
	if value, ok := args["body"]; ok {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(raw)
	}
	request := httptest.NewRequest(method, target, body)
	if headers, ok := args["headers"].(map[string]any); ok {
		for name, value := range headers {
			request.Header.Set(name, value.(string))
		}
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	answer, err := webParsed(recorder.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"status": recorder.Code, "body": answer}
	if allow := recorder.Header().Get("Allow"); allow != "" {
		result["allow"] = allow
	}
	if len(api.pending) > 0 {
		var names []string
		for _, e := range api.pending {
			names = append(names, e.Method+" "+e.Path)
		}
		t.Fatalf("API calls not made: %s", strings.Join(names, ", "))
	}
	calls := api.calls
	if calls == nil {
		calls = []any{}
	}
	result["apiCalls"] = calls
	return result, nil
}
