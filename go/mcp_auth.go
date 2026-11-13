package solvapay

// Customer sign-in for a SolvaPay MCP server. Ported from @solvapay/mcp/fetch
// (oauth-bridge.ts, cors.ts, handler.ts), @solvapay/mcp
// (internal/oauth-error-normalize.ts) and @solvapay/mcp-core
// (oauth-discovery.ts, bearer.ts, dcr-diagnostics.ts).
//
// MCP clients sign the customer in with OAuth. The server acts as the
// authorization server they see, and forwards each step to SolvaPay:
//
//   - /.well-known/oauth-protected-resource and
//     /.well-known/oauth-authorization-server: this server, and its endpoints.
//   - /oauth/register: dynamic client registration, for this product.
//   - /oauth/authorize: a redirect to SolvaPay's sign-in.
//   - /oauth/token and /oauth/revoke: forwarded as received; errors come back
//     as RFC 6749 errors.
//
// The MCP endpoint answers only a customer whose bearer token SolvaPay
// verifies (GET /v1/customer/auth/userinfo): the customer a tool sees is the
// one SolvaPay's answer names. Any other request gets a 401 that points at
// the protected-resource document.
//
// CORS: only native MCP clients' origins (cursor://, vscode://,
// vscode-webview://, claude://) are mirrored, never with credentials.

import (
	"bytes"
	"container/list"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	defaultBridgeTimeout    = 30 * time.Second
	protectedResourcePath   = "/.well-known/oauth-protected-resource"
	authorizationServerPath = "/.well-known/oauth-authorization-server"
	openIDConfigurationPath = "/.well-known/openid-configuration"
	tokenCacheTTL           = 60 * time.Second
	tokenCacheEntries       = 1000
)

var oauthScopes = []any{"openid", "profile", "email"}

// OAuthPaths are where the OAuth endpoints are served; empty fields keep the defaults.
type OAuthPaths struct {
	Register  string // "/oauth/register"
	Authorize string // "/oauth/authorize"
	Token     string // "/oauth/token"
	Revoke    string // "/oauth/revoke"
}

func (p OAuthPaths) withDefaults() OAuthPaths {
	set := func(value, fallback string) string {
		if value == "" {
			return fallback
		}
		return value
	}
	return OAuthPaths{
		Register:  set(p.Register, "/oauth/register"),
		Authorize: set(p.Authorize, "/oauth/authorize"),
		Token:     set(p.Token, "/oauth/token"),
		Revoke:    set(p.Revoke, "/oauth/revoke"),
	}
}

var oauthErrorCodes = map[string]bool{
	"invalid_request": true, "invalid_client": true, "invalid_grant": true, "unauthorized_client": true,
	"unsupported_grant_type": true, "invalid_scope": true, "server_error": true,
	"temporarily_unavailable": true, "access_denied": true,
}

// notForwarded are hop-by-hop or re-encoded headers an upstream answer must not carry on.
var notForwarded = map[string]bool{"Content-Length": true, "Content-Encoding": true, "Transfer-Encoding": true, "Connection": true}

func protectedResourceMetadata(base string) map[string]any {
	return map[string]any{"resource": base, "authorization_servers": []any{base}, "scopes_supported": oauthScopes}
}

func authorizationServerMetadata(base string, paths OAuthPaths) map[string]any {
	return map[string]any{
		"issuer":                                base,
		"authorization_endpoint":                base + paths.Authorize,
		"token_endpoint":                        base + paths.Token,
		"registration_endpoint":                 base + paths.Register,
		"revocation_endpoint":                   base + paths.Revoke,
		"token_endpoint_auth_methods_supported": []any{"client_secret_basic", "client_secret_post"},
		"response_types_supported":              []any{"code"},
		"grant_types_supported":                 []any{"authorization_code", "refresh_token"},
		"scopes_supported":                      oauthScopes,
		"code_challenge_methods_supported":      []any{"S256"},
	}
}

// ---- bearer tokens (bearer.ts) ------------------------------------------------

// extractBearerToken is the token after "Bearer " (case-sensitive), trimmed.
func extractBearerToken(authorization string) string {
	if !strings.HasPrefix(authorization, "Bearer ") {
		return ""
	}
	return jsTrim(authorization[len("Bearer "):])
}

// jwtCustomerClaim is the first non-blank of customerRef, customer_ref and
// sub in a JWT's payload, read without the signature check: it only says
// whether a token is worth asking SolvaPay about.
func jwtCustomerClaim(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	for _, claim := range []string{"customerRef", "customer_ref", "sub"} {
		if value, ok := payload[claim].(string); ok && jsTrim(value) != "" {
			return jsTrim(value)
		}
	}
	return ""
}

// ---- token verification ----------------------------------------------------------

type verifiedToken struct {
	at   time.Time
	info *auth.TokenInfo
}

// tokenVerifier asks SolvaPay who a customer's bearer token belongs to.
// Tokens SolvaPay accepts are cached briefly (least recently used out first).
type tokenVerifier struct {
	userinfo string
	client   *http.Client
	now      func() time.Time

	mu      sync.Mutex
	entries map[string]*list.Element
	order   *list.List // front: most recently used; values are tokens
	cache   map[string]verifiedToken
}

func newTokenVerifier(apiBaseURL string, client *http.Client) *tokenVerifier {
	return &tokenVerifier{
		userinfo: strings.TrimSuffix(apiBaseURL, "/") + "/v1/customer/auth/userinfo",
		client:   client,
		now:      time.Now,
		entries:  map[string]*list.Element{},
		order:    list.New(),
		cache:    map[string]verifiedToken{},
	}
}

// verify is the customer SolvaPay verified token for, or nil when SolvaPay
// does not accept the token. Any other answer is an error.
func (v *tokenVerifier) verify(ctx context.Context, token string) (*auth.TokenInfo, error) {
	now := v.now()
	v.mu.Lock()
	if cached, ok := v.cache[token]; ok && now.Sub(cached.at) < tokenCacheTTL {
		v.order.MoveToFront(v.entries[token])
		v.mu.Unlock()
		return cached.info, nil
	}
	v.mu.Unlock()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, v.userinfo, nil)
	if err != nil {
		return nil, &Error{Code: "invalid_argument", Message: err.Error()}
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	response, err := v.client.Do(request)
	if err != nil {
		return nil, &Error{Code: "network_error", Message: fmt.Sprintf("Could not reach SolvaPay to verify the token: %v", err)}
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		return nil, &Error{Code: "network_error", Message: fmt.Sprintf("Could not read SolvaPay's answer to a token check: %v", err)}
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		v.forget(token)
		return nil, nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Code: "token_verification_failed", Status: response.StatusCode, Message: fmt.Sprintf("SolvaPay answered %d when verifying a token", response.StatusCode)}
	}
	var claims map[string]any
	if err := json.Unmarshal(body, &claims); err != nil || claims == nil {
		return nil, &Error{Code: "token_verification_failed", Message: "SolvaPay's userinfo answer is not a JSON object", Body: snippet(body)}
	}
	subject, ok := claims["sub"].(string)
	if !ok || subject == "" {
		return nil, &Error{Code: "token_verification_failed", Message: "SolvaPay's userinfo has no customer (sub)"}
	}
	extra := copyJSON(claims)
	extra["customer_ref"] = subject
	info := &auth.TokenInfo{UserID: subject, Scopes: []string{"openid", "profile", "email"}, Extra: extra}

	v.mu.Lock()
	defer v.mu.Unlock()
	if element, ok := v.entries[token]; ok {
		v.order.MoveToFront(element)
	} else {
		v.entries[token] = v.order.PushFront(token)
	}
	v.cache[token] = verifiedToken{at: now, info: info}
	for v.order.Len() > tokenCacheEntries {
		oldest := v.order.Back()
		v.order.Remove(oldest)
		delete(v.entries, oldest.Value.(string))
		delete(v.cache, oldest.Value.(string))
	}
	return info, nil
}

func (v *tokenVerifier) forget(token string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if element, ok := v.entries[token]; ok {
		v.order.Remove(element)
		delete(v.entries, token)
		delete(v.cache, token)
	}
}

// ---- CORS (cors.ts) ------------------------------------------------------------

var nativeClientOrigin = regexp.MustCompile(`^(cursor|vscode|vscode-webview|claude)://.+$`)

// applyNativeCORS mirrors a native MCP client's origin. Web origins get
// nothing, and credentials are never allowed.
func applyNativeCORS(r *http.Request, header http.Header) {
	if origin := r.Header.Get("Origin"); nativeClientOrigin.MatchString(origin) {
		header.Set("Access-Control-Allow-Origin", origin)
		header.Add("Vary", "Origin")
	}
}

// corsPreflight is 204, the requested method and headers echoed, a 600 s max age.
func corsPreflight(w http.ResponseWriter, r *http.Request) {
	method := r.Header.Get("Access-Control-Request-Method")
	if method == "" {
		method = "POST"
	}
	allowed := r.Header.Get("Access-Control-Request-Headers")
	if allowed == "" {
		allowed = "authorization, content-type"
	}
	applyNativeCORS(r, w.Header())
	w.Header().Set("Access-Control-Allow-Methods", method+", OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", allowed)
	w.Header().Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	raw, err := marshalJS(body)
	if err != nil {
		panic(fmt.Sprintf("solvapay: writing a JSON answer: %v", err)) // only JSON values reach here
	}
	applyNativeCORS(r, w.Header())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// notFound is what the TypeScript handler answers for a path or method nothing claims.
func notFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = io.WriteString(w, "not_found")
}

// authChallenge is 401, a JSON-RPC -32001 error, and WWW-Authenticate
// pointing at the protected-resource document.
func (s *MCPServer) authChallenge(w http.ResponseWriter, r *http.Request, id any) {
	w.Header().Set("Access-Control-Expose-Headers", "WWW-Authenticate")
	w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata="%s%s"`, s.publicBaseURL, protectedResourcePath))
	writeJSON(w, r, http.StatusUnauthorized, map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32001, "message": "Unauthorized"}})
}

// ---- OAuth error bodies (oauth-error-normalize.ts) ------------------------------

func validationErrors(body map[string]any) []map[string]any {
	items, _ := body["errors"].([]any)
	var out []map[string]any
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			out = append(out, object)
		}
	}
	return out
}

func touches(errs []map[string]any, field string) map[string]any {
	for _, e := range errs {
		if path, ok := e["path"].([]any); ok {
			for _, part := range path {
				if part == field {
					return e
				}
			}
		}
	}
	return nil
}

// deriveOAuthErrorCode is by status first, then by the validation error's field.
func deriveOAuthErrorCode(status int, body map[string]any) string {
	switch {
	case status == 401 || status == 403:
		return "invalid_client"
	case status >= 500:
		return "server_error"
	}
	errs := validationErrors(body)
	if grantType := touches(errs, "grant_type"); grantType != nil {
		// A missing received is JavaScript's undefined; JSON null is not.
		if received, present := grantType["received"]; present && received != "undefined" && received != "" {
			return "unsupported_grant_type"
		}
		return "invalid_request"
	}
	switch {
	case touches(errs, "code") != nil || touches(errs, "refresh_token") != nil:
		return "invalid_grant"
	case touches(errs, "scope") != nil:
		return "invalid_scope"
	case touches(errs, "client_id") != nil || touches(errs, "client_secret") != nil:
		return "invalid_client"
	}
	return "invalid_request"
}

// buildErrorDescription is "path: message; …" from validation errors, else
// the message (a list joined with "; "); "" when there is none.
func buildErrorDescription(body map[string]any) string {
	var parts []string
	for _, e := range validationErrors(body) {
		var pathParts []string
		if path, ok := e["path"].([]any); ok {
			for _, part := range path {
				if text, ok := part.(string); ok {
					pathParts = append(pathParts, text)
				}
			}
		}
		pathText := strings.Join(pathParts, ".")
		message, _ := e["message"].(string)
		switch {
		case pathText != "" && message != "":
			parts = append(parts, pathText+": "+message)
		case pathText != "":
			parts = append(parts, pathText)
		case message != "":
			parts = append(parts, message)
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, "; ")
	}
	switch message := body["message"].(type) {
	case string:
		return message
	case []any:
		var texts []string
		for _, item := range message {
			if text, ok := item.(string); ok {
				texts = append(texts, text)
			}
		}
		return strings.Join(texts, "; ")
	}
	return ""
}

// toOAuthErrorBody passes a body with a token error code through and maps
// any other: a JSON object (or array, as JavaScript reads it) as NestJS's
// shape, anything else by status with short text as the description.
func toOAuthErrorBody(raw []byte, status int) map[string]any {
	var body any = map[string]any{}
	if len(raw) > 0 && json.Unmarshal(raw, &body) != nil {
		body = nil
	}
	object, isObject := body.(map[string]any)
	if code, _ := object["error"].(string); isObject && oauthErrorCodes[code] {
		return object
	}
	if _, isArray := body.([]any); isObject || isArray {
		code := deriveOAuthErrorCode(status, object)
		if description := buildErrorDescription(object); description != "" {
			return map[string]any{"error": code, "error_description": description}
		}
		return map[string]any{"error": code}
	}
	fallback := "invalid_request"
	if status >= 500 {
		fallback = "server_error"
	}
	if text := string(raw); text != "" && jsLength(text) < 500 {
		return map[string]any{"error": fallback, "error_description": text}
	}
	return map[string]any{"error": fallback}
}

var unresolvedProduct = regexp.MustCompile(`(?i)invalid identifier`)

// logDCRFailure names the likely cause of a refused registration.
func (s *MCPServer) logDCRFailure(status int, body string) {
	hint := "SolvaPay rejected the registration."
	if unresolvedProduct.MatchString(body) || (strings.Contains(strings.ToLower(body), "product_ref") && strings.Contains(strings.ToLower(body), "mcp_server_id")) {
		hint = "The platform could not resolve this product_ref (often a wrong or missing product, or an API base URL mismatch). " +
			"A 400 'Invalid identifier' here means the product did not resolve, not that the registration body was malformed."
	}
	s.logger.Warn("OAuth dynamic client registration failed. "+hint+" Check SOLVAPAY_PRODUCT_REF and SOLVAPAY_API_BASE_URL.",
		"status", status, "productRef", s.productRef, "apiBaseURL", s.client.APIBaseURL())
}

// ---- the bridge (oauth-bridge.ts) and the MCP endpoint (handler.ts) -------------

// Handler is the HTTP handler: the MCP endpoint at MCPPath, behind sign-in,
// plus the OAuth discovery documents and endpoints. A path nothing serves is
// a 404 not_found.
func (s *MCPServer) Handler() http.Handler {
	streamable := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return s.server }, &mcp.StreamableHTTPOptions{Logger: s.logger})
	verified := auth.RequireBearerToken(func(ctx context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
		info, err := s.verifier.verify(ctx, token)
		if err != nil {
			return nil, err
		}
		if info == nil {
			return nil, auth.ErrInvalidToken
		}
		return info, nil
	}, &auth.RequireBearerTokenOptions{
		ResourceMetadataURL:    s.publicBaseURL + protectedResourcePath,
		AllowMissingExpiration: true, // SolvaPay's userinfo answer carries no expiry; the cache bounds reuse
	})(streamable)
	api := s.client.APIBaseURL()
	paths := s.oauthPaths

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case s.mcpPath:
			s.serveMCP(w, r, verified)
		case openIDConfigurationPath:
			if r.Method != http.MethodGet {
				notFound(w)
				return
			}
			applyNativeCORS(r, w.Header())
			w.WriteHeader(http.StatusNotFound)
		case protectedResourcePath, authorizationServerPath:
			if r.Method != http.MethodGet {
				notFound(w)
				return
			}
			document := protectedResourceMetadata(s.publicBaseURL)
			if r.URL.Path == authorizationServerPath {
				document = authorizationServerMetadata(s.publicBaseURL, paths)
			}
			writeJSON(w, r, http.StatusOK, document)
		case paths.Register:
			switch r.Method {
			case http.MethodOptions:
				corsPreflight(w, r)
			case http.MethodPost:
				contentType := r.Header.Get("Content-Type")
				if contentType == "" {
					contentType = "application/json"
				}
				target := api + "/v1/customer/auth/register?product_ref=" + url.QueryEscape(s.productRef)
				upstream, body, err := s.forward(r, target, http.Header{"Content-Type": {contentType}})
				if err != nil {
					writeJSON(w, r, http.StatusBadGateway, map[string]any{"error": "upstream_unreachable"})
					return
				}
				if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
					s.logDCRFailure(upstream.StatusCode, string(body))
				}
				passthrough(w, r, upstream, body)
			default:
				notFound(w)
			}
		case paths.Authorize:
			switch r.Method {
			case http.MethodOptions:
				corsPreflight(w, r)
			case http.MethodGet:
				location := api + "/v1/customer/auth/authorize"
				if r.URL.RawQuery != "" {
					location += "?" + r.URL.RawQuery
				}
				applyNativeCORS(r, w.Header())
				w.Header().Set("Location", location)
				w.WriteHeader(http.StatusFound)
			default:
				notFound(w)
			}
		case paths.Token, paths.Revoke:
			target := api + "/v1/customer/auth/token"
			if r.URL.Path == paths.Revoke {
				target = api + "/v1/customer/auth/revoke"
			}
			switch r.Method {
			case http.MethodOptions:
				corsPreflight(w, r)
			case http.MethodPost:
				contentType := r.Header.Get("Content-Type")
				if contentType == "" {
					contentType = "application/x-www-form-urlencoded"
				}
				headers := http.Header{"Content-Type": {contentType}}
				if authorization := r.Header.Get("Authorization"); authorization != "" {
					headers.Set("Authorization", authorization)
				}
				// The raw body, so + and %20 in a PKCE verifier reach SolvaPay unchanged.
				upstream, body, err := s.forward(r, target, headers)
				if err != nil {
					writeJSON(w, r, http.StatusBadGateway, map[string]any{"error": "upstream_unreachable"})
					return
				}
				if upstream.StatusCode >= 200 && upstream.StatusCode < 300 {
					passthrough(w, r, upstream, body)
					return
				}
				writeJSON(w, r, upstream.StatusCode, toOAuthErrorBody(body, upstream.StatusCode))
			default:
				notFound(w)
			}
		default:
			notFound(w)
		}
	})
}

// forward posts the request's raw body to SolvaPay with only headers, and
// reads the whole answer. An error means SolvaPay could not be reached.
func (s *MCPServer) forward(r *http.Request, target string, headers http.Header) (*http.Response, []byte, error) {
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(payload))
	if err != nil {
		return nil, nil, err
	}
	request.Header = headers
	response, err := s.httpClient.Do(request)
	if err != nil {
		s.logger.Warn("SolvaPay could not be reached for an OAuth step", "url", target, "error", err)
		return nil, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		s.logger.Warn("SolvaPay's answer to an OAuth step could not be read", "url", target, "error", err)
		return nil, nil, err
	}
	return response, body, nil
}

func passthrough(w http.ResponseWriter, r *http.Request, upstream *http.Response, body []byte) {
	for name, values := range upstream.Header {
		if notForwarded[http.CanonicalHeaderKey(name)] {
			continue
		}
		for _, value := range values {
			w.Header().Add(name, value)
		}
	}
	applyNativeCORS(r, w.Header())
	w.WriteHeader(upstream.StatusCode)
	_, _ = w.Write(body)
}

func jsonRPCID(body []byte) any {
	var message map[string]any
	if json.Unmarshal(body, &message) != nil {
		return nil
	}
	return message["id"]
}

// serveMCP guards the MCP endpoint, as the TypeScript fetch handler does.
// OPTIONS is a CORS preflight; any method but POST is a 405. A request
// without a bearer token whose payload names a customer, or whose token
// SolvaPay does not accept, gets authChallenge. A verified request reaches
// the MCP server as that customer (VerifiedCustomerRef), with native CORS on
// its answer.
func (s *MCPServer) serveMCP(w http.ResponseWriter, r *http.Request, verified http.Handler) {
	switch r.Method {
	case http.MethodOptions:
		corsPreflight(w, r)
		return
	case http.MethodPost:
	default:
		applyNativeCORS(r, w.Header())
		w.Header().Set("Allow", "POST, OPTIONS")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "could not read the request body", http.StatusBadRequest)
		return
	}
	token := extractBearerToken(r.Header.Get("Authorization"))
	var info *auth.TokenInfo
	if token != "" && jwtCustomerClaim(token) != "" {
		if info, err = s.verifier.verify(r.Context(), token); err != nil {
			s.logger.Error("SolvaPay could not verify a bearer token", "error", err, "code", ErrorCode(err))
			writeJSON(w, r, http.StatusBadGateway, map[string]any{"jsonrpc": "2.0", "id": jsonRPCID(body),
				"error": map[string]any{"code": -32603, "message": "Could not verify the access token with SolvaPay"}})
			return
		}
	}
	if info == nil {
		s.authChallenge(w, r, jsonRPCID(body))
		return
	}
	applyNativeCORS(r, w.Header())
	r.Body = io.NopCloser(bytes.NewReader(body))
	verified.ServeHTTP(w, r)
}
