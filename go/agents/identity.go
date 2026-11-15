package agents

// Who is calling: SolvaPay agent tokens are ES256 JWTs signed by SolvaPay's
// agent service, published at <issuer>/jwks.json, issued for one merchant (aud
// is its provider reference, or this server's resource URL for OAuth tokens).
// Agent keys (agk_…) are long-lived and opaque: SolvaPay says whose they are.
// Anything else a caller presents is the merchant's own auth.

import (
	"context"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// Agent token claims beyond the registered ones.
const (
	// TokenExcerptClaim: the agent's spend policy lets the classifier read the end of the prompt.
	TokenExcerptClaim = "px"
	// TokenClientClaim: the OAuth client a host got the token as, on OAuth tokens only.
	TokenClientClaim = "cid"
	// TokenEnvironmentClaim: where the agent spends, sandbox or live.
	TokenEnvironmentClaim = "env"
)

// ClockToleranceSeconds is how far exp and nbf may be off.
const ClockToleranceSeconds = 30

// AgentKeyCacheTTL is how long an agent key's answer is reused; a revoked key
// stops within this.
const AgentKeyCacheTTL = 30 * time.Second

// VerifiedAgent is the agent a request was verified as.
type VerifiedAgent struct {
	// AgentRef is the agent, agt_… (the token's sub).
	AgentRef string
	// PrincipalRef is the pairwise reference of the account at this merchant, ppl_….
	PrincipalRef string
	// TokenID is the token's jti; empty for an agent key.
	TokenID string
	// ExpiresAt is when the token expires; zero for an agent key, which lasts until revoked.
	ExpiresAt time.Time
	// PromptExcerpt: the prompt's end may go to SolvaPay with this agent's calls (px).
	PromptExcerpt bool
	// Environment is where the agent spends.
	Environment Environment
	// ClientID is the OAuth client the token was issued to: a CIMD URL or oac_….
	ClientID string
}

// RejectionReason is why an agent was turned away.
type RejectionReason string

const (
	Expired             RejectionReason = "expired"
	Invalid             RejectionReason = "invalid"
	EnvironmentMismatch RejectionReason = "environment_mismatch"
)

// Rejection is an agent credential that did not verify. Detail is for people.
type Rejection struct {
	Reason RejectionReason
	Detail string
}

func (r *Rejection) Error() string {
	return "agent rejected (" + string(r.Reason) + "): " + r.Detail
}

func reject(reason RejectionReason, detail string) *Rejection {
	return &Rejection{Reason: reason, Detail: detail}
}

// checkEnvironment refuses an agent from the other environment; with the
// merchant's unknown (""), SolvaPay does at authorize.
func checkEnvironment(agent VerifiedAgent, merchant Environment) (*VerifiedAgent, error) {
	if merchant != "" && agent.Environment != merchant {
		return nil, reject(EnvironmentMismatch, "This agent spends in "+string(agent.Environment)+", and this secret key is for "+string(merchant))
	}
	return &agent, nil
}

// TokenVerifierOptions configures a TokenVerifier.
type TokenVerifierOptions struct {
	// Issuer is SolvaPay's agent token issuer, e.g. https://api.solvapay.com/v1/agent.
	Issuer string
	// ProviderRef is this merchant's provider reference; tokens for any other are refused.
	ProviderRef string
	// Resource is this server's OAuth resource (its MCP or API URL). A token a
	// host got by OAuth names it as aud, so it is accepted beside the provider
	// reference; any other URL is refused.
	Resource string
	// Keys supplies SolvaPay's public keys. nil: <Issuer>/jwks.json, fetched and cached.
	Keys KeySource
	// Environment is the environment this merchant's secret key is for
	// (SecretKeyEnvironment); an agent from the other is refused. Empty:
	// SolvaPay refuses it at authorize.
	Environment Environment
	// Now is the clock; nil means time.Now.
	Now func() time.Time
}

// TokenVerifier verifies agent tokens against SolvaPay's published keys.
type TokenVerifier struct {
	options   TokenVerifierOptions
	audiences []string
}

// NewTokenVerifier builds a TokenVerifier; a Resource that cannot be an OAuth
// resource is an error.
func NewTokenVerifier(options TokenVerifierOptions) (*TokenVerifier, error) {
	if options.Issuer == "" || options.ProviderRef == "" {
		return nil, &solvapay.Error{Code: "invalid_argument", Message: "An agent token verifier needs Issuer and ProviderRef"}
	}
	audiences := []string{options.ProviderRef}
	if options.Resource != "" {
		canonical, err := CanonicalResource(options.Resource)
		if err != nil {
			return nil, err
		}
		audiences = append(audiences, canonical)
	}
	if options.Keys == nil {
		options.Keys = &RemoteKeys{URL: strings.TrimRight(options.Issuer, "/") + "/jwks.json", Now: options.Now}
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &TokenVerifier{options: options, audiences: audiences}, nil
}

// Verify checks a token and its claims. A token that does not verify is a
// *Rejection: Expired once exp has passed (with 30 seconds of tolerance),
// EnvironmentMismatch from the other environment, Invalid otherwise.
func (v *TokenVerifier) Verify(ctx context.Context, token string) (*VerifiedAgent, error) {
	claims, err := verifyES256(ctx, token, v.options.Keys, jwtOptions{
		issuer:         v.options.Issuer,
		audiences:      v.audiences,
		requiredClaims: []string{"sub", "exp", "iat", "jti"},
		tolerance:      ClockToleranceSeconds,
		now:            v.options.Now(),
	})
	if errors.Is(err, errExpired) {
		return nil, reject(Expired, err.Error())
	}
	if err != nil {
		return nil, reject(Invalid, err.Error())
	}
	clientID, hasClient := claims[TokenClientClaim]
	clientText, isString := clientID.(string)
	if hasClient && !isString {
		return nil, reject(Invalid, "cid is not a string")
	}
	sub, _ := claims["sub"].(string)
	if !strings.HasPrefix(sub, "agt_") {
		return nil, reject(Invalid, "sub is not an agent reference")
	}
	principal, _ := claims["principal"].(string)
	if !strings.HasPrefix(principal, "ppl_") {
		return nil, reject(Invalid, "principal is missing")
	}
	if claims["scope"] != AgentScope {
		return nil, reject(Invalid, "scope is not usage")
	}
	environment, _ := claims[TokenEnvironmentClaim].(string)
	if !Environment(environment).valid() {
		return nil, reject(Invalid, "env is not sandbox or live")
	}
	exp := claims["exp"].(float64) // checkClaims made sure it is a number
	return checkEnvironment(VerifiedAgent{
		AgentRef:      sub,
		PrincipalRef:  principal,
		TokenID:       jsString(claims["jti"]),
		ExpiresAt:     time.UnixMilli(int64(math.Trunc(exp * 1000))).UTC(),
		PromptExcerpt: claims[TokenExcerptClaim] == true,
		Environment:   Environment(environment),
		ClientID:      clientText,
	}, v.options.Environment)
}

// jsString is JavaScript's String(value) for a decoded JSON value: the token
// id comes back as a string in every SDK, whatever the jti was.
func jsString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return jsNumberString(v)
	case bool:
		return strconv.FormatBool(v)
	case nil:
		return "null"
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			if item != nil {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// jsNumberString is JavaScript's Number.prototype.toString for a float64.
func jsNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	// The shortest digits that round-trip, and the decimal exponent n with
	// value = 0.digits × 10^n, as ECMA-262 Number::toString uses them.
	exp := strconv.FormatFloat(f, 'e', -1, 64)
	mantissa, power, _ := strings.Cut(exp, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(power)
	n := e + 1
	k := len(digits)
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	exponent := "+" + strconv.Itoa(n-1)
	if n-1 < 0 {
		exponent = strconv.Itoa(n - 1)
	}
	if k == 1 {
		return sign + digits + "e" + exponent
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + exponent
}

// KeyVerifier asks SolvaPay whose an agent key is, reusing each answer for
// 30 seconds. An unknown, revoked or other merchant's key is rejected, and so
// is one from the other environment; SolvaPay out of reach is an error, as
// every paid call would fail the same way.
type KeyVerifier struct {
	client      *Client
	environment Environment
	now         func() time.Time

	mu      sync.Mutex
	answers map[string]keyAnswer
}

type keyAnswer struct {
	agent *VerifiedAgent
	err   error
	until time.Time
}

// KeyVerifierOptions configures a KeyVerifier.
type KeyVerifierOptions struct {
	Client *Client
	// Environment is as for TokenVerifierOptions: empty, SolvaPay's answer decides.
	Environment Environment
	// Now is the clock; nil means time.Now.
	Now func() time.Time
}

// NewKeyVerifier builds a KeyVerifier.
func NewKeyVerifier(options KeyVerifierOptions) (*KeyVerifier, error) {
	if options.Client == nil {
		return nil, &solvapay.Error{Code: "invalid_argument", Message: "An agent key verifier needs a Client"}
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &KeyVerifier{client: options.Client, environment: options.Environment, now: now, answers: map[string]keyAnswer{}}, nil
}

// Verify answers whose agentKey is: the agent, a *Rejection, or another error
// when SolvaPay failed or answered something unreadable (not cached).
func (v *KeyVerifier) Verify(ctx context.Context, agentKey string) (*VerifiedAgent, error) {
	v.mu.Lock()
	cached, ok := v.answers[agentKey]
	v.mu.Unlock()
	if ok && cached.until.After(v.now()) {
		return cached.agent, cached.err
	}
	var agent *VerifiedAgent
	verified, err := v.client.VerifyAgentKey(ctx, agentKey)
	if err == nil {
		agent, err = checkEnvironment(VerifiedAgent{
			AgentRef:      verified.AgentRef,
			PrincipalRef:  verified.PrincipalRef,
			PromptExcerpt: verified.PromptExcerpt,
			Environment:   verified.Environment,
		}, v.environment)
	} else {
		// Only a refusal of the key itself is the agent's. SolvaPay failing, or
		// refusing the merchant (agent payments off, a secret key for the other
		// environment), is returned for the merchant to fix.
		reason, agents := AgentRefusal(err)
		if !agents {
			return nil, err
		}
		var apiErr *solvapay.Error
		errors.As(err, &apiErr)
		agent, err = nil, reject(reason, apiErr.Message)
	}
	v.mu.Lock()
	v.answers[agentKey] = keyAnswer{agent: agent, err: err, until: v.now().Add(AgentKeyCacheTTL)}
	v.mu.Unlock()
	return agent, err
}

// AgentRefusal says whose a 401 or 403 from SolvaPay's agent endpoints is, as
// in TypeScript. The agent's (true): the token or key is unknown, revoked or
// another merchant's (401, or 403 with no code: Invalid), or from the other
// environment (403 environment_mismatch: EnvironmentMismatch). Any other code,
// such as feature_not_enabled (agent payments are off for this merchant) or
// key_env_mismatch (the secret key is for the other environment), is the
// merchant's: false.
func AgentRefusal(err error) (RejectionReason, bool) {
	var apiErr *solvapay.Error
	if !errors.As(err, &apiErr) {
		return "", false
	}
	switch {
	case apiErr.Status == 401:
		return Invalid, true
	case apiErr.Status != 403:
		return "", false
	case apiErr.Code == "http_403": // SolvaPay sent no code
		return Invalid, true
	case apiErr.Code == "environment_mismatch":
		return EnvironmentMismatch, true
	}
	return "", false
}

var compactJWS = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)

// LooksLikeJWT says whether value is a JWS compact token, as opposed to a
// merchant API key.
func LooksLikeJWT(value string) bool { return compactJWS.MatchString(value) }

// IsAgentKey says whether value is an agent key.
func IsAgentKey(value string) bool {
	return strings.HasPrefix(value, AgentKeyPrefix) && len(value) > len(AgentKeyPrefix)
}

// IdentificationKind is what a presented credential turned out to be.
type IdentificationKind string

const (
	// KindAgent: a verified agent.
	KindAgent IdentificationKind = "agent"
	// KindNotAgent: not an agent's credential; the merchant's own auth decides.
	KindNotAgent IdentificationKind = "not_agent"
	// KindRejected: an agent credential that did not verify.
	KindRejected IdentificationKind = "rejected"
)

// Identification is who presented a credential.
type Identification struct {
	Kind      IdentificationKind
	Agent     *VerifiedAgent
	Rejection *Rejection
}

// AgentLayer tells an agent's credential from the merchant's own, and
// verifies it.
type AgentLayer struct {
	// Tokens verifies agent tokens.
	Tokens *TokenVerifier
	// Keys accepts agent keys too; nil, an agent key is the merchant's own auth's to answer.
	Keys *KeyVerifier
}

// Identify reads a presented credential. The error is SolvaPay failing while
// an agent key was checked; a credential that did not verify is KindRejected.
func (l *AgentLayer) Identify(ctx context.Context, presented string) (Identification, error) {
	if IsAgentKey(presented) && l.Keys != nil {
		return identification(l.Keys.Verify(ctx, presented))
	}
	if !LooksLikeJWT(presented) {
		return Identification{Kind: KindNotAgent}, nil
	}
	return identification(l.Tokens.Verify(ctx, presented))
}

func identification(agent *VerifiedAgent, err error) (Identification, error) {
	var rejection *Rejection
	if errors.As(err, &rejection) {
		return Identification{Kind: KindRejected, Rejection: rejection}, nil
	}
	if err != nil {
		return Identification{}, err
	}
	return Identification{Kind: KindAgent, Agent: agent}, nil
}
