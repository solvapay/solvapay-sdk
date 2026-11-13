package conformance

// Suite agent-identity: the agents package's identity, OAuth helpers and
// prompt facts, plus what the three agent suites share (the scripted
// SolvaPay API). Mirrors conformance/runners/typescript/src/agent-identity.ts
// and python/conformance_runner/_agent_identity.py.
//
// Operations: verifyAgentTokens, promptFacts, oauthResources. Scenario steps:
// verifyAgentKey, identify.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
	"github.com/solvapay/solvapay-sdk/go/agents"
)

const conformanceAPI = "https://api.conformance.test"

// ---- the scripted SolvaPay API --------------------------------------------------

// apiStub answers SolvaPay requests from a case's exchanges (each once, the
// first that matches method and path) and records every request with its
// body. Anything else fails the test.
type apiStub struct {
	t       *testing.T
	mu      sync.Mutex
	pending []map[string]any
	calls   []any
}

func (s *apiStub) script(exchanges any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending = nil
	list, _ := exchanges.([]any)
	for _, exchange := range list {
		s.pending = append(s.pending, exchange.(map[string]any))
	}
	s.calls = []any{}
}

func (s *apiStub) RoundTrip(req *http.Request) (*http.Response, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	call := map[string]any{"method": req.Method, "path": req.URL.EscapedPath()}
	if req.Body != nil {
		raw, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			body, err := decodeJSON(raw)
			if err != nil {
				s.t.Errorf("request body is not JSON: %s", raw)
			}
			call["body"] = body
		}
	}
	s.calls = append(s.calls, call)
	for i, exchange := range s.pending {
		if exchange["method"] == req.Method && exchange["path"] == req.URL.EscapedPath() {
			s.pending = append(s.pending[:i], s.pending[i+1:]...)
			status := 200
			if n, ok := exchange["status"].(json.Number); ok {
				i, _ := n.Int64()
				status = int(i)
			}
			body, err := json.Marshal(exchange["body"])
			if err != nil {
				s.t.Fatal(err)
			}
			return &http.Response{
				StatusCode: status,
				Header:     http.Header{"Content-Type": {"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(body)),
				Request:    req,
			}, nil
		}
	}
	s.t.Errorf("unexpected API call: %s %s", req.Method, req.URL.EscapedPath())
	return nil, fmt.Errorf("unexpected API call: %s %s", req.Method, req.URL.EscapedPath())
}

func (s *apiStub) unused() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, e := range s.pending {
		out = append(out, fmt.Sprintf("%v %v", e["method"], e["path"]))
	}
	return out
}

func (s *apiStub) recorded() []any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]any{}, s.calls...)
}

// agentClient talks to the stub as the merchant sk_sandbox_conformance,
// without retries (TypeScript never retries).
func agentClient(t *testing.T, stub *apiStub) *agents.Client {
	t.Helper()
	zero := 0
	client, err := agents.NewClient(solvapay.Config{
		APIKey:     "sk_sandbox_conformance",
		APIBaseURL: conformanceAPI,
		MaxRetries: &zero,
		HTTPClient: &http.Client{Transport: stub},
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

// ---- reading a case's arguments --------------------------------------------------

// remarshal reads a decoded case value into a typed one.
func remarshal(t *testing.T, value any, out any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
}

func str(args map[string]any, key string) string {
	s, _ := args[key].(string)
	return s
}

func number(t *testing.T, value any) float64 {
	t.Helper()
	n, ok := value.(json.Number)
	if !ok {
		t.Fatalf("%v is not a number", value)
	}
	f, err := n.Float64()
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func parseClock(t *testing.T, text string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		t.Fatalf("clock %q: %v", text, err)
	}
	return parsed
}

// isoString is JavaScript's toISOString: milliseconds and Z.
func isoString(at time.Time) string { return at.UTC().Format("2006-01-02T15:04:05.000Z") }

// ---- outcomes --------------------------------------------------------------------

// The SDK's own refusal sentences. Any other detail comes from the JWT code or
// the API's error text, which differ by language and are for people, so it
// compares as a placeholder.
var sdkDetails = []*regexp.Regexp{
	regexp.MustCompile(`^cid is not a string$`),
	regexp.MustCompile(`^sub is not an agent reference$`),
	regexp.MustCompile(`^principal is missing$`),
	regexp.MustCompile(`^scope is not usage$`),
	regexp.MustCompile(`^env is not sandbox or live$`),
	regexp.MustCompile(`^This agent spends in (sandbox|live), and this secret key is for (sandbox|live)$`),
	regexp.MustCompile(`^.* cannot be an OAuth resource: no fragment or credentials$`),
}

func comparableDetail(detail string) string {
	for _, pattern := range sdkDetails {
		if pattern.MatchString(detail) {
			return detail
		}
	}
	return "<not compared>"
}

func agentOutcome(agent *agents.VerifiedAgent) map[string]any {
	out := map[string]any{
		"agentRef":      agent.AgentRef,
		"principalRef":  agent.PrincipalRef,
		"promptExcerpt": agent.PromptExcerpt,
		"environment":   string(agent.Environment),
	}
	if agent.TokenID != "" {
		out["tokenId"] = agent.TokenID
	}
	if !agent.ExpiresAt.IsZero() {
		out["expiresAt"] = isoString(agent.ExpiresAt)
	}
	if agent.ClientID != "" {
		out["clientId"] = agent.ClientID
	}
	return out
}

// tokenOutcome is a verifier's answer: the agent, a rejection, or (for an agent
// key SolvaPay failed or misanswered on) what was thrown, with its HTTP status.
func tokenOutcome(t *testing.T, agent *agents.VerifiedAgent, err error) map[string]any {
	t.Helper()
	var rejection *agents.Rejection
	switch {
	case err == nil:
		return map[string]any{"ok": true, "agent": agentOutcome(agent)}
	case asRejection(err, &rejection):
		return map[string]any{"ok": false, "reason": string(rejection.Reason), "detail": comparableDetail(rejection.Detail)}
	}
	return thrown(t, err)
}

func asRejection(err error, out **agents.Rejection) bool {
	r, ok := err.(*agents.Rejection)
	if ok {
		*out = r
	}
	return ok
}

// thrown is an error a verifier returns (SolvaPay failing or misanswering):
// its HTTP status when the API answered with one, else null.
func thrown(t *testing.T, err error) map[string]any {
	t.Helper()
	sdkErr, ok := err.(*solvapay.Error)
	if !ok {
		t.Fatalf("an error without a code is a bug, not an outcome: %v", err)
	}
	var status any
	if sdkErr.Status >= 400 {
		status = sdkErr.Status
	}
	return map[string]any{"thrown": map[string]any{"status": status}}
}

func identificationOutcome(identification agents.Identification) map[string]any {
	switch identification.Kind {
	case agents.KindAgent:
		return map[string]any{"kind": "agent", "agent": agentOutcome(identification.Agent)}
	case agents.KindRejected:
		return map[string]any{
			"kind":   "rejected",
			"reason": string(identification.Rejection.Reason),
			"detail": comparableDetail(identification.Rejection.Detail),
		}
	}
	return map[string]any{"kind": string(identification.Kind)}
}

// ---- operations ------------------------------------------------------------------

func tokenVerifier(t *testing.T, args map[string]any, now func() time.Time) *agents.TokenVerifier {
	t.Helper()
	var jwks agents.JWKS
	remarshal(t, args["jwks"], &jwks)
	verifier, err := agents.NewTokenVerifier(agents.TokenVerifierOptions{
		Issuer:      str(args, "issuer"),
		ProviderRef: str(args, "providerRef"),
		Resource:    str(args, "resource"),
		Environment: agents.Environment(str(args, "environment")),
		Keys:        agents.StaticKeys(jwks),
		Now:         now,
	})
	if err != nil {
		t.Fatal(err)
	}
	return verifier
}

func init() {
	register("verifyAgentTokens", func(t *testing.T, args map[string]any, clock *time.Time) (any, error) {
		if clock == nil {
			t.Fatal("verifyAgentTokens needs input.clock")
		}
		verifier := tokenVerifier(t, args, func() time.Time { return *clock })
		out := map[string]any{}
		for label, token := range args["tokens"].(map[string]any) {
			agent, err := verifier.Verify(context.Background(), token.(string))
			out[label] = tokenOutcome(t, agent, err)
		}
		return out, nil
	})

	// Each prompt's text is its parts joined, each repeated repeat times (default 1).
	register("promptFacts", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		out := map[string]any{}
		for label, value := range args["prompts"].(map[string]any) {
			prompt := value.(map[string]any)
			var text strings.Builder
			for _, item := range prompt["parts"].([]any) {
				part := item.(map[string]any)
				repeat := 1
				if r, ok := part["repeat"]; ok {
					repeat = int(number(t, r))
				}
				text.WriteString(strings.Repeat(part["text"].(string), repeat))
			}
			// TypeScript's default when toolError is left out is false.
			toolError, _ := prompt["toolError"].(bool)
			out[label] = agents.NewPromptFacts(text.String(), toolError)
		}
		return out, nil
	})

	register("oauthResources", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		out := map[string]any{}
		for label, value := range args["resources"].(map[string]any) {
			given := value.(map[string]any)
			canonical, err := agents.CanonicalResource(str(given, "resource"))
			if err != nil {
				out[label] = map[string]any{"refused": comparableDetail(err.(*solvapay.Error).Message)}
				continue
			}
			resource := agents.ProtectedResource{
				Resource:            str(given, "resource"),
				AuthorizationServer: str(given, "authorizationServer"),
				Documentation:       str(given, "documentation"),
				MetadataPath:        str(given, "metadataPath"),
			}
			metadata, err := resource.Metadata(str(given, "serverName"))
			if err != nil {
				t.Fatal(err)
			}
			path, err := resource.MetadataPathFor()
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			if err := resource.WriteAuthChallenge(recorder, str(given, "description"), given["jsonRpcId"]); err != nil {
				t.Fatal(err)
			}
			body, err := decodeJSON(recorder.Body.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			out[label] = map[string]any{
				"canonical":    canonical,
				"metadata":     metadata,
				"metadataPath": path,
				"challenge": map[string]any{
					"status": recorder.Code,
					"headers": map[string]any{
						"www-authenticate":              recorder.Header().Get("WWW-Authenticate"),
						"access-control-expose-headers": recorder.Header().Get("Access-Control-Expose-Headers"),
						"content-type":                  recorder.Header().Get("Content-Type"),
					},
					"body": body,
				},
			}
		}
		return out, nil
	})

	scenarioRunners = append(scenarioRunners, runAgentIdentityScenario)
}

// ---- scenario steps --------------------------------------------------------------
//
// One agent key verifier per scenario and merchant environment (unset by
// default), so its 30-second cache carries across steps. Its clock, and the
// token verifier's, is the step's.

func runAgentIdentityScenario(t *testing.T, data map[string]any) ([]any, bool) {
	steps := data["steps"].([]any)
	for _, step := range steps {
		fn := step.(map[string]any)["fn"]
		if fn != "verifyAgentKey" && fn != "identify" {
			return nil, false
		}
	}
	stub := &apiStub{t: t}
	client := agentClient(t, stub)
	var now time.Time
	clock := func() time.Time { return now }
	keyVerifiers := map[string]*agents.KeyVerifier{}
	keyVerifier := func(environment string) *agents.KeyVerifier {
		key := environment
		if key == "" {
			key = "unset"
		}
		if keyVerifiers[key] == nil {
			verifier, err := agents.NewKeyVerifier(agents.KeyVerifierOptions{Client: client, Environment: agents.Environment(environment), Now: clock})
			if err != nil {
				t.Fatal(err)
			}
			keyVerifiers[key] = verifier
		}
		return keyVerifiers[key]
	}

	var outcomes []any
	for i, item := range steps {
		step := item.(map[string]any)
		args := step["args"].(map[string]any)
		now = parseClock(t, step["clock"].(string))
		stub.script(step["api"])
		var result any
		switch step["fn"] {
		case "verifyAgentKey":
			agent, err := keyVerifier(str(args, "environment")).Verify(context.Background(), str(args, "agentKey"))
			result = tokenOutcome(t, agent, err)
		case "identify":
			layer := &agents.AgentLayer{Tokens: tokenVerifier(t, args, clock)}
			if args["acceptAgentKeys"] == true {
				layer.Keys = keyVerifier(str(args, "environment"))
			}
			identification, err := layer.Identify(context.Background(), str(args, "presentedKey"))
			if err != nil {
				result = thrown(t, err)
			} else {
				result = identificationOutcome(identification)
			}
		}
		if unused := stub.unused(); len(unused) > 0 {
			t.Fatalf("step %d (%v): API exchanges not used: %v", i+1, step["fn"], unused)
		}
		outcomes = append(outcomes, map[string]any{"result": result, "apiCalls": stub.recorded()})
	}
	return outcomes, true
}
