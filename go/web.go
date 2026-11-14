package solvapay

// The HTTP routes the @solvapay/react components call on the merchant's
// backend (/api/check-purchase, /api/create-payment-intent, …), ported from
// @solvapay/server/fetch's solvapayRoutes() (packages/server/src/fetch) and the
// *Core helpers behind it (packages/server/src/helpers). The web-routes
// conformance cases say what each route answers and which SolvaPay requests it
// makes.
//
// Identity comes only from WebOptions.GetUser, the merchant's own verified
// auth: no header the browser sends is ever taken as the user.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

// WebUser is the person the merchant's own auth has verified: ID is your user
// id (the SolvaPay customer's externalRef); Email and Name are used when the
// customer is created.
type WebUser struct {
	ID    string
	Email string
	Name  string
}

// WebOptions configures NewWebHandler.
type WebOptions struct {
	// Client talks to SolvaPay. Required.
	Client *Client
	// GetUser verifies the request with your own auth and answers who is
	// calling. Required. Return (nil, nil) for a request without valid
	// credentials (the route answers 401) and an error when verification
	// itself failed (the route answers 500). Never trust a client header here.
	GetUser func(*http.Request) (*WebUser, error)
	// BasePath is where the routes live; empty means "/api", React's default.
	// Use "/" to serve them at the root.
	BasePath string
	// ReturnURL is where hosted checkout sends the buyer back when the request
	// names none; empty means the request's own origin. Set it behind a proxy
	// that changes the scheme or host.
	ReturnURL string
	// CORSOrigins are the origins allowed to call the routes from a browser;
	// nil means any origin ("*"), as @solvapay/server/fetch does.
	CORSOrigins []string
}

// The route names (React's default path without /api/), each with its
// methods in the order @solvapay/server/fetch lists them (SOLVAPAY_ROUTES).
var webRouteTable = []struct {
	name    string
	methods []string
}{
	{"check-purchase", []string{"GET"}},
	{"create-payment-intent", []string{"POST"}},
	{"process-payment", []string{"POST"}},
	{"create-topup-payment-intent", []string{"POST"}},
	{"process-topup-payment", []string{"POST"}},
	{"attach-business-details", []string{"POST"}},
	{"customer-balance", []string{"GET"}},
	{"cancel-renewal", []string{"POST"}},
	{"reactivate-renewal", []string{"POST"}},
	{"activate-plan", []string{"POST"}},
	{"create-checkout-session", []string{"POST"}},
	{"create-customer-session", []string{"POST"}},
	{"merchant", []string{"GET"}},
	{"get-product", []string{"GET"}},
	{"list-plans", []string{"GET"}},
	{"payment-method", []string{"GET"}},
	{"auto-recharge", []string{"GET", "PUT", "DELETE"}},
	{"usage", []string{"GET"}},
	{"limits", []string{"GET"}},
	{"history", []string{"GET"}},
	{"sync-customer", []string{"POST"}},
	{"track-usage", []string{"POST"}},
}

// WebRouteNames are the routes NewWebHandler serves, under its base path.
func WebRouteNames() []string {
	names := make([]string, len(webRouteTable))
	for i, route := range webRouteTable {
		names[i] = route.name
	}
	return names
}

const (
	unauthorizedWebDetails = "User ID not found. Ensure middleware is configured."
	maxWebBody             = 1 << 20
)

// topupBalancePollDelays are the waits before each balance read after a
// top-up succeeds (TOPUP_BALANCE_POLL_DELAYS_MS).
var topupBalancePollDelays = []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second, 4 * time.Second}

// webFailure is an answer other than 200: {"error", "details"?} with a status.
type webFailure struct {
	status  int
	error   string
	details string
}

type webRequest struct {
	r    *http.Request
	ctx  context.Context
	body map[string]any
}

type webHandler struct {
	client    *Client
	getUser   func(*http.Request) (*WebUser, error)
	base      string
	returnURL string
	origins   []string
	paywall   *Paywall
	routes    map[string]map[string]func(*webHandler, *webRequest) (any, *webFailure)
	allow     map[string]string
}

// NewWebHandler serves every route the @solvapay/react components call, at
// their default paths under options.BasePath. An unknown path answers 404, a
// known path with another method 405 with Allow, OPTIONS the CORS preflight.
// The webhook route is not included: mount it yourself (see webhooks.go).
func NewWebHandler(options WebOptions) (http.Handler, error) {
	if options.Client == nil {
		return nil, newError("invalid_argument", "NewWebHandler needs a Client")
	}
	if options.GetUser == nil {
		return nil, newError("invalid_argument", "NewWebHandler needs GetUser: the routes take identity only from your own verified auth")
	}
	paywall, err := NewPaywall(options.Client, PaywallOptions{})
	if err != nil {
		return nil, err
	}
	base := options.BasePath
	if base == "" {
		base = "/api"
	}
	base = strings.TrimRight(base, "/")
	origins := options.CORSOrigins
	if origins == nil {
		origins = []string{"*"}
	}
	h := &webHandler{
		client:    options.Client,
		getUser:   options.GetUser,
		base:      base,
		returnURL: options.ReturnURL,
		origins:   origins,
		paywall:   paywall,
		allow:     map[string]string{},
	}
	h.routes = map[string]map[string]func(*webHandler, *webRequest) (any, *webFailure){
		"check-purchase":              {"GET": (*webHandler).checkPurchase},
		"create-payment-intent":       {"POST": (*webHandler).createPaymentIntent},
		"process-payment":             {"POST": (*webHandler).processPayment},
		"create-topup-payment-intent": {"POST": (*webHandler).createTopupPaymentIntent},
		"process-topup-payment":       {"POST": (*webHandler).processTopupPayment},
		"attach-business-details":     {"POST": (*webHandler).attachBusinessDetails},
		"customer-balance":            {"GET": (*webHandler).customerBalance},
		"cancel-renewal":              {"POST": (*webHandler).cancelRenewal},
		"reactivate-renewal":          {"POST": (*webHandler).reactivateRenewal},
		"activate-plan":               {"POST": (*webHandler).activatePlan},
		"create-checkout-session":     {"POST": (*webHandler).createCheckoutSession},
		"create-customer-session":     {"POST": (*webHandler).createCustomerSession},
		"merchant":                    {"GET": (*webHandler).merchant},
		"get-product":                 {"GET": (*webHandler).getProduct},
		"list-plans":                  {"GET": (*webHandler).listPlans},
		"payment-method":              {"GET": (*webHandler).paymentMethod},
		"auto-recharge": {
			"GET":    (*webHandler).getAutoRecharge,
			"PUT":    (*webHandler).saveAutoRecharge,
			"DELETE": (*webHandler).disableAutoRecharge,
		},
		"usage":         {"GET": (*webHandler).usage},
		"limits":        {"GET": (*webHandler).limits},
		"history":       {"GET": (*webHandler).history},
		"sync-customer": {"POST": (*webHandler).syncCustomer},
		"track-usage":   {"POST": (*webHandler).trackUsage},
	}
	for _, route := range webRouteTable {
		if len(h.routes[route.name]) != len(route.methods) {
			panic("solvapay: web route table out of step: " + route.name)
		}
		h.allow[route.name] = strings.Join(route.methods, ", ")
	}
	return h, nil
}

func (h *webHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name, ok := strings.CutPrefix(r.URL.EscapedPath(), h.base+"/")
	methods := h.routes[name]
	if !ok || methods == nil {
		h.write(w, r, http.StatusNotFound, map[string]any{"error": "Not found"})
		return
	}
	if r.Method == http.MethodOptions {
		h.cors(w, r)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	route := methods[strings.ToUpper(r.Method)]
	if route == nil {
		w.Header().Set("Allow", h.allow[name])
		h.write(w, r, http.StatusMethodNotAllowed, map[string]any{"error": "Method not allowed"})
		return
	}
	call := &webRequest{r: r, ctx: r.Context()}
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		body, failure := readWebBody(w, r)
		if failure != nil {
			h.fail(w, r, failure)
			return
		}
		call.body = body
	}
	value, failure := route(h, call)
	if failure != nil {
		h.fail(w, r, failure)
		return
	}
	h.write(w, r, http.StatusOK, value)
}

// readWebBody reads a JSON object body; an empty body is {}. TypeScript reads
// a body that is not JSON as {} too; here it is refused, so a broken client
// shows up as a 400 instead of a misleading "missing parameter".
func readWebBody(w http.ResponseWriter, r *http.Request) (map[string]any, *webFailure) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebBody))
	if err != nil {
		return nil, &webFailure{status: http.StatusBadRequest, error: "Invalid request body", details: err.Error()}
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]any{}, nil
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil || body == nil {
		details := "The body must be a JSON object"
		if err != nil {
			details = err.Error()
		}
		return nil, &webFailure{status: http.StatusBadRequest, error: "Invalid JSON body", details: details}
	}
	return body, nil
}

func (h *webHandler) cors(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-solvapay-customer-ref")
	header.Set("Access-Control-Max-Age", "86400")
	origin := r.Header.Get("Origin")
	for _, allowed := range h.origins {
		if allowed == "*" {
			header.Set("Access-Control-Allow-Origin", "*")
			return
		}
	}
	for _, allowed := range h.origins {
		if origin != "" && allowed == origin {
			header.Set("Access-Control-Allow-Origin", origin)
			header.Set("Vary", "Origin")
			return
		}
	}
}

func (h *webHandler) write(w http.ResponseWriter, r *http.Request, status int, value any) {
	raw, err := marshalJS(value)
	if err != nil {
		h.cors(w, r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		failed, _ := marshalJS(map[string]any{"error": "The answer cannot be written as JSON", "details": err.Error()})
		_, _ = w.Write(failed)
		return
	}
	h.cors(w, r)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func (h *webHandler) fail(w http.ResponseWriter, r *http.Request, failure *webFailure) {
	body := map[string]any{"error": failure.error}
	if failure.details != "" {
		body["details"] = failure.details
	}
	h.write(w, r, failure.status, body)
}

// ---- identity and customer ----------------------------------------------------

// user is the verified caller, from GetUser only.
func (h *webHandler) user(call *webRequest) (*WebUser, *webFailure) {
	user, err := h.getUser(call.r)
	if err != nil {
		return nil, &webFailure{status: http.StatusInternalServerError, error: "Authentication failed", details: err.Error()}
	}
	if user == nil {
		return nil, &webFailure{status: http.StatusUnauthorized, error: "Unauthorized", details: unauthorizedWebDetails}
	}
	if user.ID == "" {
		return nil, &webFailure{status: http.StatusInternalServerError, error: "Authentication failed", details: "GetUser answered a user without an ID"}
	}
	return user, nil
}

// ensure finds or creates the user's customer by externalRef (the user id).
// A user id that starts with cus_ is still a user id: unlike TypeScript's
// ensureCustomer, it is never used as that customer.
func (h *webHandler) ensure(ctx context.Context, user *WebUser) (string, error) {
	ref, err := h.paywall.ensureUserCustomer(ctx, user.ID, EnsureCustomerOptions{Email: user.Email, Name: user.Name})
	var apiErr *Error
	if err != nil && errors.As(err, &apiErr) && apiErr.answer != nil {
		op := "Get customer"
		if apiErr.answer.method == http.MethodPost {
			op = "Create customer"
		}
		return "", described(op, err)
	}
	return ref, err
}

// customer is the verified caller's customer ref (syncCustomerCore); a
// failure is answered with defaultMessage when it is not SolvaPay's.
func (h *webHandler) customer(call *webRequest, defaultMessage string) (string, *webFailure) {
	user, failure := h.user(call)
	if failure != nil {
		return "", failure
	}
	ref, err := h.ensure(call.ctx, user)
	if err != nil {
		return "", routeFailure(err, defaultMessage)
	}
	return ref, nil
}

// ---- errors -------------------------------------------------------------------

// answerDetail is what TypeScript's client says about a failed answer: the
// body (cut at 240 UTF-16 units), or a note that it was not JSON.
func answerDetail(answer *apiAnswer) string {
	body := string(answer.body)
	units := utf16.Encode([]rune(body))
	snippet := body
	if len(units) > 240 {
		snippet = string(utf16.Decode(units[:240])) + "…"
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(answer.contentType, ";")[0]))
	nonJSON := false
	if !strings.Contains(contentType, "json") {
		nonJSON = strings.HasPrefix(strings.TrimLeft(body, " \t\r\n"), "<") || contentType != ""
	}
	if nonJSON {
		shown := answer.contentType
		if shown == "" {
			shown = "unknown content-type"
		}
		return fmt.Sprintf("non-JSON response (%s) — the API may not have been reached. Body: %s", shown, snippet)
	}
	return snippet
}

// described rewrites an API failure's message as TypeScript's client words it:
// "<op> failed (<status>): <body>". Other errors pass unchanged.
func described(op string, err error) error {
	var apiErr *Error
	if err == nil || !errors.As(err, &apiErr) || apiErr.answer == nil {
		return err
	}
	copied := *apiErr
	copied.Message = fmt.Sprintf("%s failed (%d): %s", op, apiErr.Status, answerDetail(apiErr.answer))
	return &copied
}

// routeFailure is handleRouteError: an SDK error answers its message and
// status (500 without one); anything else, and a network failure (a thrown
// fetch in TypeScript), answers defaultMessage with the error as details.
func routeFailure(err error, defaultMessage string) *webFailure {
	var sdkErr *Error
	if errors.As(err, &sdkErr) && !(sdkErr.Code == "network_error" && sdkErr.Status == 0) {
		status := sdkErr.Status
		if status == 0 {
			status = http.StatusInternalServerError
		}
		return &webFailure{status: status, error: sdkErr.Message, details: sdkErr.Message}
	}
	if sdkErr != nil {
		return &webFailure{status: http.StatusInternalServerError, error: defaultMessage, details: sdkErr.Message}
	}
	return &webFailure{status: http.StatusInternalServerError, error: defaultMessage, details: err.Error()}
}

// apiStatus is the HTTP status of an API failure, or 0.
func apiStatus(err error) int {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr.Status
	}
	return 0
}

func badRequest(message string) *webFailure {
	return &webFailure{status: http.StatusBadRequest, error: message}
}

// ---- small readers -------------------------------------------------------------

func bodyText(body map[string]any, key string) string {
	text, _ := jsNonEmptyString(body[key])
	return text
}

// present copies the keys of from that are set (undefined drops out, null stays).
func present(into, from map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if value, ok := from[key]; ok {
			into[key] = value
		}
	}
	return into
}

// rawJSON sends one request and answers its JSON as it came; an empty answer is an error.
func (h *webHandler) rawJSON(ctx context.Context, op, method, path string, query url.Values, body any) (json.RawMessage, error) {
	raw, err := h.client.Request(ctx, method, path, query, nil, body)
	if err != nil {
		return nil, described(op, err)
	}
	if raw == nil {
		return nil, &Error{Code: "invalid_response", Message: op + ": the SolvaPay API answered with an empty body"}
	}
	return raw, nil
}

func customerRefOf(customer map[string]any) string {
	ref, _ := jsNonEmptyString(customer["reference"])
	return ref
}

// ---- check-purchase and usage -------------------------------------------------

func activePurchases(customer map[string]any) ([]any, error) {
	listed := jsGet(customer, "purchases")
	if jsNullish(listed) {
		return []any{}, nil
	}
	purchases, ok := listed.([]any)
	if !ok {
		return nil, &Error{Code: "invalid_response", Message: "The customer answer's purchases is not a list"}
	}
	active := []any{}
	for _, purchase := range purchases {
		if jsGet(purchase, "status") == "active" {
			active = append(active, purchase)
		}
	}
	return active, nil
}

func purchaseCheck(customer map[string]any, ref string) (map[string]any, error) {
	active, err := activePurchases(customer)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"customerRef": ref, "purchases": active}
	return present(out, customer, "email", "name"), nil
}

// purchases is checkPurchaseCore. x-solvapay-customer-ref is only a cache
// hint: used when that customer's externalRef is the verified user's id.
func (h *webHandler) purchases(call *webRequest) (map[string]any, *webFailure) {
	const defaultMessage = "Failed to check purchase"
	user, failure := h.user(call)
	if failure != nil {
		return nil, failure
	}
	if cached := call.r.Header.Get("x-solvapay-customer-ref"); cached != "" {
		customer, err := h.client.GetCustomer(call.ctx, cached)
		switch {
		case err == nil:
			if ref := customerRefOf(customer); ref != "" && jsGet(customer, "externalRef") == user.ID {
				out, err := purchaseCheck(customer, ref)
				if err != nil {
					return nil, routeFailure(err, defaultMessage)
				}
				return out, nil
			}
		case apiStatus(err) == http.StatusNotFound:
			// A stale hint: look the user's customer up instead.
		default:
			// TypeScript ignores every failure here; only a missing customer
			// is a stale hint, anything else fails loudly.
			return nil, routeFailure(described("Get customer", err), defaultMessage)
		}
	}
	// TypeScript answers {customerRef: userId, purchases: []} when this part
	// fails, which reads as "no purchases"; here the failure is reported.
	ref, err := h.ensure(call.ctx, user)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	customer, err := h.client.GetCustomer(call.ctx, ref)
	if err != nil {
		return nil, routeFailure(described("Get customer", err), defaultMessage)
	}
	ref = customerRefOf(customer)
	if ref == "" {
		return nil, routeFailure(&Error{Code: "invalid_response", Message: "The customer answer has no reference"}, defaultMessage)
	}
	out, err := purchaseCheck(customer, ref)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return out, nil
}

func (h *webHandler) checkPurchase(call *webRequest) (any, *webFailure) {
	return h.purchases(call)
}

// usageSnapshot is deriveUsageSnapshot.
func usageSnapshot(period map[string]any, limits map[string]any) map[string]any {
	out := map[string]any{"meterRef": nil, "total": nil, "used": nil, "remaining": nil, "percentUsed": nil}
	for key, value := range period {
		if jsTruthy(value) {
			out[key] = value
		}
	}
	if limits == nil {
		return out
	}
	remainingCount, _ := jsNum(limits["remaining"])
	var remaining, total, used any
	if remainingCount >= 0 {
		remaining = remainingCount
	}
	if limit, ok := jsNum(limits["limit"]); ok && limit > 0 {
		total = limit
	}
	if count, ok := jsNum(limits["used"]); ok {
		used = count
	} else if total != nil && remaining != nil {
		used = math.Max(0, total.(float64)-remaining.(float64))
	}
	var percent any
	if total != nil && used != nil {
		percent = math.Min(100, math.Floor(used.(float64)/total.(float64)*10000+0.5)/100)
	}
	out["meterRef"] = jsCoalesce(jsGet(limits, "meterName"), nil)
	out["total"], out["used"], out["remaining"], out["percentUsed"] = total, used, remaining, percent
	return out
}

func (h *webHandler) usage(call *webRequest) (any, *webFailure) {
	check, failure := h.purchases(call)
	if failure != nil {
		return nil, failure
	}
	purchases := check["purchases"].([]any)
	if len(purchases) == 0 {
		return usageSnapshot(nil, nil), nil
	}
	active := purchases[0]
	period := map[string]any{
		"periodStart": jsGet(jsGet(active, "usage"), "periodStart"),
		"periodEnd":   jsGet(jsGet(active, "usage"), "periodEnd"),
		"purchaseRef": jsGet(active, "reference"),
	}
	snapshot := jsGet(active, "planSnapshot")
	counted := CountsUsage(snapshot) || jsGet(snapshot, "isMetered") == true
	productRef, hasProduct := jsNonEmptyString(jsGet(active, "productRef"))
	if !counted || !hasProduct {
		return usageSnapshot(period, nil), nil
	}
	limits, err := h.client.CheckLimits(call.ctx, map[string]any{"customerRef": check["customerRef"], "productRef": productRef})
	if err != nil {
		return nil, routeFailure(described("Check limits", err), "Failed to get usage")
	}
	return usageSnapshot(period, limits), nil
}

func (h *webHandler) limits(call *webRequest) (any, *webFailure) {
	query := call.r.URL.Query()
	productRef := query.Get("productRef")
	if productRef == "" {
		return nil, badRequest("Missing required parameter: productRef")
	}
	meterName := query.Get("meterName")
	if meterName == "" {
		meterName = "requests"
	}
	const defaultMessage = "Failed to check limits"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	limits, err := h.client.CheckLimits(call.ctx, map[string]any{"customerRef": ref, "productRef": productRef, "meterName": meterName})
	if err != nil {
		return nil, routeFailure(described("Check limits", err), defaultMessage)
	}
	return limits, nil
}

// ---- customer -----------------------------------------------------------------

func (h *webHandler) syncCustomer(call *webRequest) (any, *webFailure) {
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	return map[string]any{"customerRef": ref}, nil
}

func (h *webHandler) customerBalance(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Failed to get customer credits"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	balance, err := h.client.GetCustomerBalance(call.ctx, ref)
	if err != nil {
		return nil, routeFailure(described("Get customer balance", err), defaultMessage)
	}
	return balance, nil
}

func (h *webHandler) paymentMethod(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Failed to load payment method"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	method, err := h.rawJSON(call.ctx, "Get payment method", http.MethodGet, "/v1/sdk/payment-method", url.Values{"customerRef": {ref}}, nil)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return method, nil
}

func (h *webHandler) trackUsage(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Track usage failed"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	body := present(map[string]any{"customerRef": ref}, call.body, "actionType", "units", "productRef", "description", "metadata", "idempotencyKey")
	answer, err := h.rawJSON(call.ctx, "Track usage", http.MethodPost, "/v1/sdk/usages", nil, body)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return answer, nil
}

// ---- auto-recharge ------------------------------------------------------------

func (h *webHandler) getAutoRecharge(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Failed to load auto-recharge"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	answer, err := h.rawJSON(call.ctx, "Get auto-recharge", http.MethodGet, "/v1/sdk/auto-recharge", url.Values{"customerRef": {ref}}, nil)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return answer, nil
}

func (h *webHandler) saveAutoRecharge(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Failed to save auto-recharge"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	body := map[string]any{}
	for key, value := range call.body {
		body[key] = value
	}
	// The verified user's customer always wins over one in the body.
	body["customerRef"] = ref
	answer, err := h.rawJSON(call.ctx, "Save auto-recharge", http.MethodPut, "/v1/sdk/auto-recharge", nil, body)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return answer, nil
}

func (h *webHandler) disableAutoRecharge(call *webRequest) (any, *webFailure) {
	const defaultMessage = "Failed to disable auto-recharge"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	answer, err := h.rawJSON(call.ctx, "Disable auto-recharge", http.MethodDelete, "/v1/sdk/auto-recharge", url.Values{"customerRef": {ref}}, nil)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return answer, nil
}

// ---- payments -----------------------------------------------------------------

func intentAnswer(intent map[string]any, customerRef string) map[string]any {
	out := present(map[string]any{}, intent, "processorPaymentId", "clientSecret", "publishableKey", "accountId")
	out["customerRef"] = customerRef
	return out
}

func (h *webHandler) createPaymentIntent(call *webRequest) (any, *webFailure) {
	planRef, productRef := bodyText(call.body, "planRef"), bodyText(call.body, "productRef")
	if planRef == "" || productRef == "" {
		return nil, badRequest("Missing required parameters: planRef and productRef are required")
	}
	const defaultMessage = "Payment intent creation failed"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	body := map[string]any{"productRef": productRef, "planRef": planRef, "customerRef": ref}
	if currency := bodyText(call.body, "currency"); currency != "" {
		body["currency"] = currency
	}
	intent, err := h.client.CreatePaymentIntent(call.ctx, body, idempotencyKey("payment-"+planRef))
	if err != nil {
		return nil, routeFailure(described("Create payment intent", err), defaultMessage)
	}
	return intentAnswer(intent, ref), nil
}

func (h *webHandler) createTopupPaymentIntent(call *webRequest) (any, *webFailure) {
	amount, ok := jsNum(call.body["amount"])
	if !ok || !(amount > 0) {
		return nil, badRequest("Missing or invalid amount: must be a positive number")
	}
	currency := bodyText(call.body, "currency")
	if currency == "" {
		return nil, badRequest("Missing required parameter: currency")
	}
	if currency != strings.ToUpper(currency) {
		return nil, badRequest(fmt.Sprintf(`Invalid currency "%s": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")`, currency))
	}
	const defaultMessage = "Topup payment intent creation failed"
	ref, failure := h.customer(call, defaultMessage)
	if failure != nil {
		return nil, failure
	}
	body := present(map[string]any{"customerRef": ref, "purpose": "credit_topup", "amount": call.body["amount"], "currency": currency}, call.body, "description")
	if autoRecharge := call.body["autoRecharge"]; jsTruthy(autoRecharge) {
		body["autoRecharge"] = autoRecharge
	}
	intent, err := h.client.CreatePaymentIntent(call.ctx, body, idempotencyKey("topup"))
	if err != nil {
		return nil, routeFailure(described("Create topup payment intent", err), defaultMessage)
	}
	return intentAnswer(intent, ref), nil
}

func (h *webHandler) processPayment(call *webRequest) (any, *webFailure) {
	paymentIntentID, productRef := bodyText(call.body, "paymentIntentId"), bodyText(call.body, "productRef")
	if paymentIntentID == "" || productRef == "" {
		return nil, badRequest("paymentIntentId and productRef are required")
	}
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	body := map[string]any{"productRef": productRef, "customerRef": ref}
	if planRef := bodyText(call.body, "planRef"); planRef != "" {
		body["planRef"] = planRef
	}
	result, err := h.client.ProcessPaymentIntent(call.ctx, paymentIntentID, body)
	if err != nil {
		return nil, routeFailure(described("Process payment", err), "Payment processing failed")
	}
	return result, nil
}

func (h *webHandler) credits(ctx context.Context, customerRef string) (float64, error) {
	balance, err := h.client.GetCustomerBalance(ctx, customerRef)
	if err != nil {
		return 0, described("Get customer balance", err)
	}
	credits, ok := jsNum(balance["credits"])
	if !ok {
		return 0, &Error{Code: "invalid_response", Message: "The balance answer has no credits"}
	}
	return credits, nil
}

// processTopupPayment is processTopupPaymentIntentCore. TypeScript carries on
// without creditsAdded when a balance read fails; here a failed read fails
// the request, since the answer could not be confirmed.
func (h *webHandler) processTopupPayment(call *webRequest) (any, *webFailure) {
	paymentIntentID := bodyText(call.body, "paymentIntentId")
	if paymentIntentID == "" {
		return nil, badRequest("paymentIntentId is required")
	}
	const defaultMessage = "Topup payment processing failed"
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	before, err := h.credits(call.ctx, ref)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	result, err := h.client.ProcessPaymentIntent(call.ctx, paymentIntentID, map[string]any{"customerRef": ref})
	if err != nil {
		return nil, routeFailure(described("Process payment", err), defaultMessage)
	}
	switch status := jsGet(result, "status"); status {
	case "timeout":
		return present(map[string]any{"status": "timeout"}, result, "message"), nil
	case "failed", "cancelled":
		return map[string]any{"status": status}, nil
	case "succeeded":
	default:
		// Any other status is not a success (as in TypeScript).
		return map[string]any{"status": "failed"}, nil
	}
	for _, delay := range topupBalancePollDelays {
		if err := sleep(call.ctx, delay); err != nil {
			return nil, routeFailure(&Error{Code: "network_error", Message: err.Error()}, defaultMessage)
		}
		after, err := h.credits(call.ctx, ref)
		if err != nil {
			return nil, routeFailure(err, defaultMessage)
		}
		if after > before {
			return map[string]any{"status": "succeeded", "creditsAdded": after - before}, nil
		}
	}
	// Credited later by the webhook: the payment itself succeeded.
	return map[string]any{"status": "succeeded"}, nil
}

func jsTypeName(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case jsUndefinedType:
		return "undefined"
	case bool:
		return "boolean"
	case string:
		return "string"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	if _, ok := jsNum(v); ok {
		return "number"
	}
	return "object"
}

func (h *webHandler) attachBusinessDetails(call *webRequest) (any, *webFailure) {
	paymentIntentID := bodyText(call.body, "paymentIntentId")
	if paymentIntentID == "" {
		return nil, badRequest("paymentIntentId is required")
	}
	// The schema's type checks, in its order, with zod's words.
	if _, ok := call.body["isBusiness"].(bool); !ok {
		return nil, badRequest("Invalid input: expected boolean, received " + jsTypeName(jsGet(call.body, "isBusiness")))
	}
	text := map[string]string{}
	for _, key := range []string{"businessName", "country", "customerCountry", "customerName", "customerState", "customerPostalCode", "taxId", "taxIdType"} {
		value := jsGet(call.body, key)
		if value == jsUndefined {
			continue
		}
		s, ok := value.(string)
		if !ok {
			return nil, badRequest("Invalid input: expected string, received " + jsTypeName(value))
		}
		text[key] = s
	}
	details, err := ValidateBusinessDetails(BusinessDetailsInput{
		IsBusiness:         call.body["isBusiness"] == true,
		BusinessName:       text["businessName"],
		Country:            text["country"],
		CustomerCountry:    text["customerCountry"],
		CustomerName:       text["customerName"],
		CustomerState:      text["customerState"],
		CustomerPostalCode: text["customerPostalCode"],
		TaxID:              text["taxId"],
		TaxIDType:          text["taxIdType"],
	})
	var invalid *Error
	if errors.As(err, &invalid) && invalid.Code == "invalid_business_details" {
		return nil, badRequest(invalid.Message)
	}
	if err != nil {
		return nil, routeFailure(err, "Failed to attach business details")
	}
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	validated, err := toJSONValue(details)
	if err != nil {
		return nil, routeFailure(err, "Failed to attach business details")
	}
	// The fields TypeScript's client sends.
	body := present(map[string]any{}, validated.(map[string]any), "isBusiness", "businessName", "country", "taxId", "taxIdType")
	body["customerRef"] = ref
	result, err := h.client.AttachBusinessDetails(call.ctx, paymentIntentID, body)
	if err != nil {
		return nil, routeFailure(described("Attach business details", err), "Failed to attach business details")
	}
	return result, nil
}

// ---- renewal --------------------------------------------------------------------

func purchaseIn(response map[string]any) map[string]any {
	if purchase, ok := response["purchase"].(map[string]any); ok {
		return purchase
	}
	return response
}

// ownPurchase is requireOwnPurchase: the purchase must be the verified
// user's customer's, or the route answers 403 and changes nothing.
func (h *webHandler) ownPurchase(call *webRequest, purchaseRef, defaultMessage string) *webFailure {
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return failure
	}
	purchase, err := h.client.GetPurchase(call.ctx, purchaseRef)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.answer != nil {
			if apiErr.Status == http.StatusNotFound {
				return &webFailure{status: http.StatusNotFound, error: "Purchase not found", details: "Purchase not found: " + answerDetail(apiErr.answer)}
			}
			message := described("Get purchase", err).(*Error).Message
			return &webFailure{status: http.StatusInternalServerError, error: message, details: message}
		}
		return routeFailure(err, defaultMessage)
	}
	if jsGet(purchase, "customerRef") != ref {
		return &webFailure{status: http.StatusForbidden, error: "Forbidden", details: purchaseOfAnotherCustomer}
	}
	return nil
}

func (h *webHandler) cancelRenewal(call *webRequest) (any, *webFailure) {
	purchaseRef := bodyText(call.body, "purchaseRef")
	if purchaseRef == "" {
		return nil, badRequest("Missing required parameter: purchaseRef is required")
	}
	const defaultMessage = "Failed to cancel purchase"
	if failure := h.ownPurchase(call, purchaseRef, defaultMessage); failure != nil {
		return nil, failure
	}
	body := map[string]any{}
	if reason := bodyText(call.body, "reason"); reason != "" {
		body["reason"] = reason
	}
	response, err := h.client.CancelPurchase(call.ctx, purchaseRef, body)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.answer != nil {
			detail := answerDetail(apiErr.answer)
			switch apiErr.Status {
			case http.StatusNotFound:
				return nil, &webFailure{status: http.StatusNotFound, error: "Purchase not found", details: "Purchase not found: " + detail}
			case http.StatusBadRequest:
				const refused = "Purchase cannot be cancelled or does not belong to provider"
				return nil, &webFailure{status: http.StatusBadRequest, error: refused, details: refused + ": " + detail}
			}
			message := described("Cancel purchase", err).(*Error).Message
			return nil, &webFailure{status: http.StatusInternalServerError, error: message, details: message}
		}
		return nil, routeFailure(err, defaultMessage)
	}
	purchase := purchaseIn(response)
	if !jsTruthy(jsGet(purchase, "reference")) {
		return nil, &webFailure{status: http.StatusInternalServerError, error: "Cancel purchase response missing required fields"}
	}
	if jsGet(purchase, "status") != "cancelled" && !jsTruthy(jsGet(purchase, "cancelledAt")) {
		return nil, &webFailure{status: http.StatusInternalServerError, error: fmt.Sprintf("Purchase cancellation failed: backend returned status '%s' without cancelledAt timestamp", jsString(jsGet(purchase, "status")))}
	}
	if err := sleep(call.ctx, renewalSettle); err != nil {
		return nil, routeFailure(&Error{Code: "network_error", Message: err.Error()}, defaultMessage)
	}
	return purchase, nil
}

func (h *webHandler) reactivateRenewal(call *webRequest) (any, *webFailure) {
	purchaseRef := bodyText(call.body, "purchaseRef")
	if purchaseRef == "" {
		return nil, badRequest("Missing required parameter: purchaseRef is required")
	}
	const defaultMessage = "Failed to reactivate purchase"
	if failure := h.ownPurchase(call, purchaseRef, defaultMessage); failure != nil {
		return nil, failure
	}
	response, err := h.client.ReactivatePurchase(call.ctx, purchaseRef)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.answer != nil {
			// TypeScript tells these apart by words in the API's message; the
			// status says the same without depending on wording.
			message := described("Reactivate purchase", err).(*Error).Message
			switch apiErr.Status {
			case http.StatusNotFound:
				return nil, &webFailure{status: http.StatusNotFound, error: "Purchase not found", details: message}
			case http.StatusBadRequest:
				return nil, &webFailure{status: http.StatusBadRequest, error: "Purchase cannot be reactivated", details: message}
			}
			return nil, &webFailure{status: http.StatusInternalServerError, error: message, details: message}
		}
		return nil, routeFailure(err, defaultMessage)
	}
	purchase := purchaseIn(response)
	if !jsTruthy(jsGet(purchase, "reference")) {
		return nil, &webFailure{status: http.StatusInternalServerError, error: "Reactivate purchase response missing required fields"}
	}
	if jsTruthy(jsGet(purchase, "cancelledAt")) {
		return nil, &webFailure{status: http.StatusInternalServerError, error: "Purchase reactivation failed: cancelledAt is still set"}
	}
	if err := sleep(call.ctx, renewalSettle); err != nil {
		return nil, routeFailure(&Error{Code: "network_error", Message: err.Error()}, defaultMessage)
	}
	return purchase, nil
}

// ---- plans, checkout and hosted pages ------------------------------------------

func (h *webHandler) activatePlan(call *webRequest) (any, *webFailure) {
	productRef, planRef := bodyText(call.body, "productRef"), bodyText(call.body, "planRef")
	if productRef == "" || planRef == "" {
		return nil, badRequest("Missing required parameters: productRef and planRef are required")
	}
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	result, err := h.client.ActivatePlan(call.ctx, map[string]any{"customerRef": ref, "productRef": productRef, "planRef": planRef})
	if err != nil {
		return nil, routeFailure(described("Activate plan", err), "Plan activation failed")
	}
	return result, nil
}

// origin is the request's own origin (scheme and host), or "" when unknown.
func origin(r *http.Request) string {
	if r.URL.Scheme != "" && r.URL.Host != "" {
		return r.URL.Scheme + "://" + r.URL.Host
	}
	if r.Host == "" {
		return ""
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (h *webHandler) createCheckoutSession(call *webRequest) (any, *webFailure) {
	productRef := bodyText(call.body, "productRef")
	if productRef == "" {
		return nil, badRequest("Missing required parameter: productRef is required")
	}
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	body := map[string]any{"customerRef": ref, "productRef": productRef}
	if planRef := bodyText(call.body, "planRef"); planRef != "" {
		body["planRef"] = planRef
	}
	// returnUrl: null asks for none; otherwise the request's, the configured
	// one, or the request's origin.
	if jsGet(call.body, "returnUrl") != nil {
		returnURL := bodyText(call.body, "returnUrl")
		if returnURL == "" {
			returnURL = h.returnURL
		}
		if returnURL == "" {
			returnURL = origin(call.r)
		}
		if returnURL != "" {
			body["returnUrl"] = returnURL
		}
	}
	if purpose := call.body["purpose"]; jsTruthy(purpose) {
		body["purpose"] = purpose
	}
	session, err := h.client.CreateCheckoutSession(call.ctx, body)
	if err != nil {
		return nil, routeFailure(described("Create checkout session", err), "Checkout session creation failed")
	}
	return present(map[string]any{}, session, "sessionId", "checkoutUrl"), nil
}

func (h *webHandler) createCustomerSession(call *webRequest) (any, *webFailure) {
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	session, err := h.client.CreateCustomerSession(call.ctx, map[string]any{"customerRef": ref})
	if err != nil {
		return nil, routeFailure(described("Create customer session", err), "Customer session creation failed")
	}
	return session, nil
}

// merchant, get-product and list-plans answer public catalogue details and,
// as in TypeScript, do not ask who is calling.
func (h *webHandler) merchant(call *webRequest) (any, *webFailure) {
	merchant, err := h.client.GetMerchant(call.ctx)
	if err != nil {
		return nil, routeFailure(described("Get merchant", err), "Failed to fetch merchant")
	}
	return merchant, nil
}

func (h *webHandler) getProduct(call *webRequest) (any, *webFailure) {
	productRef := call.r.URL.Query().Get("productRef")
	if productRef == "" {
		return nil, badRequest("Missing required parameter: productRef")
	}
	product, err := h.client.GetProduct(call.ctx, productRef)
	if err != nil {
		return nil, routeFailure(described("Get product", err), "Failed to fetch product")
	}
	return product, nil
}

// plansOf reads a plans answer (a list, or {plans}) as TypeScript's client
// does: each plan's data fields lifted beside its own, which win.
func plansOf(raw json.RawMessage) ([]any, error) {
	var answer any
	if err := json.Unmarshal(raw, &answer); err != nil {
		return nil, &Error{Code: "invalid_response", Message: "The plans answer is not JSON"}
	}
	listed, isList := answer.([]any)
	if !isList {
		wrapped := jsGet(answer, "plans")
		if jsNullish(wrapped) {
			return []any{}, nil
		}
		if listed, isList = wrapped.([]any); !isList {
			return nil, &Error{Code: "invalid_response", Message: "The plans answer's plans is not a list"}
		}
	}
	plans := make([]any, len(listed))
	for i, item := range listed {
		plan, ok := item.(map[string]any)
		if !ok {
			return nil, &Error{Code: "invalid_response", Message: "A plan in the plans answer is not an object"}
		}
		unwrapped := map[string]any{}
		data, _ := plan["data"].(map[string]any)
		for key, value := range data {
			unwrapped[key] = value
		}
		for key, value := range plan {
			unwrapped[key] = value
		}
		if price := jsCoalesce(jsGet(plan, "price"), jsGet(data, "price")); price != jsUndefined {
			unwrapped["price"] = price
		}
		delete(unwrapped, "data")
		plans[i] = unwrapped
	}
	return plans, nil
}

func (h *webHandler) listPlans(call *webRequest) (any, *webFailure) {
	productRef := call.r.URL.Query().Get("productRef")
	if productRef == "" {
		return nil, badRequest("Missing required parameter: productRef")
	}
	const defaultMessage = "Failed to fetch plans"
	segment, err := PathSegment(productRef)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	raw, err := h.rawJSON(call.ctx, "List plans", http.MethodGet, "/v1/sdk/products/"+segment+"/plans", nil, nil)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	plans, err := plansOf(raw)
	if err != nil {
		return nil, routeFailure(err, defaultMessage)
	}
	return map[string]any{"plans": plans, "productRef": productRef}, nil
}

// ---- history --------------------------------------------------------------------

// jsNumberFrom is Number(text) for the decimal forms a query carries.
func jsNumberFrom(text string) (float64, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.NaN(), false
	}
	return n, true
}

func (h *webHandler) history(call *webRequest) (any, *webFailure) {
	query := call.r.URL.Query()
	limit := 0
	if raw := query.Get("limit"); raw != "" {
		n, ok := jsNumberFrom(raw)
		if !ok || n != math.Trunc(n) || math.IsInf(n, 0) || n < 1 {
			return nil, badRequest("limit must be a positive integer")
		}
		limit = int(n)
	}
	productRef := query.Get("productRef")
	if productRef == "" {
		return nil, badRequest("getHistory requires productRef")
	}
	const defaultMessage = "Failed to load history"
	ref, failure := h.customer(call, "Failed to sync customer")
	if failure != nil {
		return nil, failure
	}
	// One after the other, so SolvaPay sees them in TypeScript's order.
	purchases, err := h.client.ListPurchases(call.ctx, ref, productRef)
	if err != nil {
		return nil, routeFailure(described("List purchases", err), defaultMessage)
	}
	activity, err := h.client.GetCreditActivity(call.ctx, ref, limit)
	if err != nil {
		return nil, routeFailure(described("Get credit activity", err), defaultMessage)
	}
	charges := jsCoalesce(jsGet(purchases, "purchases"), []any{})
	return map[string]any{"charges": charges, "creditActivity": activity}, nil
}
