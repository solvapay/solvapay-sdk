package solvapay

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// webTestAPI answers every SolvaPay request with answer and records the request.
type webTestAPI struct {
	answer string
	calls  []string
	bodies []string
}

func (a *webTestAPI) RoundTrip(r *http.Request) (*http.Response, error) {
	a.calls = append(a.calls, r.Method+" "+r.URL.Path)
	body := ""
	if r.Body != nil {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
	}
	a.bodies = append(a.bodies, body)
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(a.answer)), Request: r}, nil
}

func webTestHandler(t *testing.T, api *webTestAPI, options WebOptions) http.Handler {
	t.Helper()
	retries := 0
	client, err := NewClient(Config{APIKey: "sk_sandbox_test", APIBaseURL: "https://api.test", MaxRetries: &retries, HTTPClient: &http.Client{Transport: api}})
	if err != nil {
		t.Fatal(err)
	}
	options.Client = client
	handler, err := NewWebHandler(options)
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func serveWeb(handler http.Handler, method, target string, body string, headers map[string]string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestNewWebHandlerNeedsClientAndGetUser(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sk_sandbox_test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewWebHandler(WebOptions{Client: client}); ErrorCode(err) != "invalid_argument" {
		t.Fatalf("nil GetUser: %v", err)
	}
	getUser := func(*http.Request) (*WebUser, error) { return nil, nil }
	if _, err := NewWebHandler(WebOptions{GetUser: getUser}); ErrorCode(err) != "invalid_argument" {
		t.Fatalf("nil Client: %v", err)
	}
}

func TestWebClientUserIDIsNotIdentity(t *testing.T) {
	api := &webTestAPI{answer: `{}`}
	handler := webTestHandler(t, api, WebOptions{GetUser: func(*http.Request) (*WebUser, error) { return nil, nil }})
	got := serveWeb(handler, "GET", "https://app.test/api/customer-balance", "", map[string]string{"x-user-id": "victim", "x-solvapay-customer-ref": "cus_victim"})
	if got.Code != 401 || len(api.calls) != 0 {
		t.Fatalf("status %d, calls %v, body %s", got.Code, api.calls, got.Body)
	}
}

func TestWebGetUserFailureIsLoud(t *testing.T) {
	api := &webTestAPI{answer: `{}`}
	handler := webTestHandler(t, api, WebOptions{GetUser: func(*http.Request) (*WebUser, error) { return nil, errors.New("session store down") }})
	got := serveWeb(handler, "GET", "https://app.test/api/check-purchase", "", nil)
	if got.Code != 500 || !strings.Contains(got.Body.String(), "session store down") || len(api.calls) != 0 {
		t.Fatalf("status %d, body %s", got.Code, got.Body)
	}
	empty := webTestHandler(t, api, WebOptions{GetUser: func(*http.Request) (*WebUser, error) { return &WebUser{}, nil }})
	if got := serveWeb(empty, "GET", "https://app.test/api/check-purchase", "", nil); got.Code != 500 {
		t.Fatalf("user without an ID: status %d", got.Code)
	}
}

func TestWebBasePath(t *testing.T) {
	api := &webTestAPI{answer: `{"displayName":"M"}`}
	handler := webTestHandler(t, api, WebOptions{BasePath: "/billing/", GetUser: func(*http.Request) (*WebUser, error) { return nil, nil }})
	if got := serveWeb(handler, "GET", "https://app.test/billing/merchant", "", nil); got.Code != 200 {
		t.Fatalf("under the base path: %d %s", got.Code, got.Body)
	}
	if got := serveWeb(handler, "GET", "https://app.test/api/merchant", "", nil); got.Code != 404 {
		t.Fatalf("default path still served: %d", got.Code)
	}
	root := webTestHandler(t, api, WebOptions{BasePath: "/", GetUser: func(*http.Request) (*WebUser, error) { return nil, nil }})
	if got := serveWeb(root, "GET", "https://app.test/merchant", "", nil); got.Code != 200 {
		t.Fatalf("at the root: %d", got.Code)
	}
}

func TestWebPreflightAndBadBody(t *testing.T) {
	api := &webTestAPI{answer: `{}`}
	user := func(*http.Request) (*WebUser, error) { return &WebUser{ID: "cus_known"}, nil }
	handler := webTestHandler(t, api, WebOptions{GetUser: user, CORSOrigins: []string{"https://shop.test"}})
	got := serveWeb(handler, "OPTIONS", "https://app.test/api/auto-recharge", "", map[string]string{"Origin": "https://shop.test"})
	if got.Code != 204 || got.Header().Get("Access-Control-Allow-Origin") != "https://shop.test" {
		t.Fatalf("preflight: %d %v", got.Code, got.Header())
	}
	got = serveWeb(handler, "POST", "https://app.test/api/create-payment-intent", "{not json", nil)
	if got.Code != 400 || len(api.calls) != 0 {
		t.Fatalf("bad JSON: %d %s", got.Code, got.Body)
	}
}

func TestWebSaveAutoRechargeKeepsTheUsersCustomer(t *testing.T) {
	// One answer for both calls: the externalRef lookup finds cus_mine, then the save.
	api := &webTestAPI{answer: `{"enabled":true,"reference":"cus_mine","customerRef":"cus_mine"}`}
	user := func(*http.Request) (*WebUser, error) { return &WebUser{ID: "user_mine"}, nil }
	handler := webTestHandler(t, api, WebOptions{GetUser: user})
	got := serveWeb(handler, "PUT", "https://app.test/api/auto-recharge", `{"enabled":true,"customerRef":"cus_someone_else"}`, nil)
	if got.Code != 200 || len(api.bodies) != 2 || !strings.Contains(api.bodies[1], `"customerRef":"cus_mine"`) {
		t.Fatalf("status %d, sent %v", got.Code, api.bodies)
	}
}

func TestWebUserIDLikeACustomerRefIsLookedUpByExternalRef(t *testing.T) {
	api := &webTestAPI{answer: `{"reference":"cus_mine","customerRef":"cus_mine","credits":0}`}
	user := func(*http.Request) (*WebUser, error) { return &WebUser{ID: "cus_victim"}, nil }
	handler := webTestHandler(t, api, WebOptions{GetUser: user})
	got := serveWeb(handler, "GET", "https://app.test/api/customer-balance", "", nil)
	if got.Code != 200 || len(api.calls) == 0 || api.calls[0] != "GET /v1/sdk/customers" {
		t.Fatalf("the user id must be looked up by externalRef first: %d %v %s", got.Code, api.calls, got.Body)
	}
	for _, call := range api.calls {
		if strings.Contains(call, "cus_victim") {
			t.Fatalf("the user id was used as a customer ref: %v", api.calls)
		}
	}
}
