// Package agents is SolvaPay agent payments for a merchant's Go server: who is
// calling (agent tokens and agent keys), authorizing and completing each paid
// call, the OAuth protected-resource helpers, and an MCP route agents call. It
// behaves as TypeScript's @solvapay/agents does; the shared conformance cases
// (agent-identity, agent-calls, agent-mcp) say how.
package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// Environment is where an agent spends: sandbox agents at sandbox merchants,
// live at live.
type Environment string

const (
	Sandbox Environment = "sandbox"
	Live    Environment = "live"
)

func (e Environment) valid() bool { return e == Sandbox || e == Live }

// AgentKeyPrefix starts an agent key: long-lived, for one merchant, sent in
// place of an agent token.
const AgentKeyPrefix = "agk_"

// AuthorizeWaitMaxSeconds is the longest one authorize request may hold; a
// longer wait is a series of requests.
const AuthorizeWaitMaxSeconds = 55

// requestTimeout bounds every request but a held authorize, which may take its
// wait on top.
const requestTimeout = 10 * time.Second

// SecretKeyEnvironment is the environment a merchant secret key is for, or ""
// when its prefix doesn't say.
func SecretKeyEnvironment(secretKey string) Environment {
	switch {
	case strings.HasPrefix(secretKey, "sk_sandbox_"):
		return Sandbox
	case strings.HasPrefix(secretKey, "sk_live_"):
		return Live
	}
	return ""
}

// Money on the wire: a decimal amount with up to 8 places and its ISO 4217
// currency, always together.
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

// ServerRefusalReason is why SolvaPay refused a call.
type ServerRefusalReason = string

// SolvaPay's own refusal reasons.
var serverRefusalReasons = []string{
	"customer_not_linked", "ask", "deny", "topup_required", "approval_declined", "approval_expired",
}

// AuthorizeInput is what a paid call asks SolvaPay before it runs.
type AuthorizeInput struct {
	// AgentToken is the token (or agent key) the call came with; SolvaPay verifies it again.
	AgentToken string `json:"agentToken"`
	// RequestID is the merchant's id for the call; a repeat continues the same call.
	RequestID string `json:"requestId"`
	// Item is the merchant's label for what is used (a model id, a tool name).
	Item string `json:"item"`
	// Estimate is what the call may cost, in the merchant's currency.
	Estimate Money `json:"estimate"`
	// PromptHash is "sha256:" over the call's prompt; repeats show loops.
	PromptHash string `json:"promptHash,omitempty"`
	// ToolError says the prompt carries a tool result marked as an error.
	ToolError *bool `json:"toolError,omitempty"`
	// PromptExcerpt is the end of the prompt, only when the agent token allows it.
	PromptExcerpt *string `json:"promptExcerpt,omitempty"`
	// Wait is how many seconds this request may hold while the owner decides, 0 to 55.
	Wait int `json:"wait"`
}

// Reservation is what SolvaPay holds for an allowed call, in USD credits.
type Reservation struct {
	Held      Money  `json:"held"`
	ExpiresAt string `json:"expiresAt"`
}

// Approval is the owner's pending decision on a waiting call.
type Approval struct {
	Reference string `json:"reference"`
	ExpiresAt string `json:"expiresAt"`
}

// Authorize statuses.
const (
	StatusAllowed = "allowed"
	StatusRefused = "refused"
	StatusWaiting = "waiting"
)

// AuthorizeResponse is SolvaPay's answer: go ahead (Reservation), refused with
// why (Reason, Message), or still waiting for the owner (Message, Approval,
// RetryAfterSeconds).
type AuthorizeResponse struct {
	Status            string
	CallRef           string
	Reservation       *Reservation
	Reason            ServerRefusalReason
	Message           string
	Approval          *Approval
	RetryAfterSeconds int
}

// CompleteInput settles a call at how the upstream answered.
type CompleteInput struct {
	// Status is the status the upstream answered with.
	Status int `json:"status"`
	// Cost is the cost the upstream reported, in its currency; nil when none arrived.
	Cost *Money `json:"cost"`
	// Interrupted is set when the answer broke before it finished, with why.
	Interrupted string `json:"interrupted,omitempty"`
}

// CompleteResponse is how SolvaPay settled a call.
type CompleteResponse struct {
	CallRef string `json:"callRef"`
	// Settled is false when nothing was charged (the upstream answered an error).
	Settled bool `json:"settled"`
	// Source is reported, provisional or none.
	Source string `json:"source"`
	// Amount is what was settled, in USD credits.
	Amount    Money `json:"amount"`
	Duplicate bool  `json:"duplicate"`
}

// VerifiedAgentKey is the agent behind an agent key, as SolvaPay answers for
// this merchant.
type VerifiedAgentKey struct {
	AgentRef      string
	PrincipalRef  string
	PromptExcerpt bool
	Environment   Environment
}

// UsageReport is the merchant's usage for one customer and window.
type UsageReport struct {
	ReportID    string `json:"reportId"`
	CustomerRef string `json:"customerRef"`
	// Source is where the merchant read its usage, for example opper:/v2/analytics/usage.
	Source string `json:"source"`
	// Window is ISO 8601, [from, to), in decision times.
	Window struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"window"`
	// Currency is the currency every cost below is in.
	Currency string `json:"currency"`
	Calls    []struct {
		CallRef string `json:"callRef"`
		Cost    string `json:"cost"`
	} `json:"calls"`
	Untagged []struct {
		At   string `json:"at"`
		Cost string `json:"cost"`
	} `json:"untagged"`
}

// ReconciledCall is one call of a usage report, as SolvaPay reconciled it.
// Empty strings are fields SolvaPay left out.
type ReconciledCall struct {
	CallRef      string `json:"callRef,omitempty"`
	Result       string `json:"result"`
	Reason       string `json:"reason,omitempty"`
	Reported     string `json:"reported,omitempty"`
	BookedPolicy string `json:"bookedPolicy,omitempty"`
	BookedCredit string `json:"bookedCredit,omitempty"`
	PolicyDelta  string `json:"policyDelta,omitempty"`
	CreditDelta  string `json:"creditDelta,omitempty"`
}

// UsageReportResponse is SolvaPay's reconciliation of a usage report.
type UsageReportResponse struct {
	Reference string           `json:"reference"`
	Currency  string           `json:"currency"`
	Duplicate bool             `json:"duplicate"`
	Results   []ReconciledCall `json:"results"`
	Untagged  struct {
		Total        string `json:"total"`
		BeforePolicy string `json:"beforePolicy"`
		Flagged      bool   `json:"flagged"`
	} `json:"untagged"`
}

// Client calls SolvaPay's agent endpoints with the merchant's secret key:
// authorize before a paid call, complete after it, and usage reports.
type Client struct {
	api *solvapay.Client
}

// NewClient builds a Client. Without an HTTPClient it uses one with no overall
// timeout, since a held authorize may take up to 65 seconds; each request has
// its own deadline instead.
func NewClient(config solvapay.Config) (*Client, error) {
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{}
	}
	api, err := solvapay.NewClient(config)
	if err != nil {
		return nil, err
	}
	return &Client{api: api}, nil
}

// NewClientFrom wraps an existing API client; its HTTP timeout must allow a
// held authorize (wait + 10 s).
func NewClientFrom(api *solvapay.Client) *Client { return &Client{api: api} }

func (c *Client) post(ctx context.Context, path string, body any, timeout time.Duration) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	raw, err := c.api.Request(ctx, http.MethodPost, path, nil, nil, body)
	if err != nil {
		return nil, err
	}
	var value any
	if raw != nil {
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, unreadable("%v", err)
		}
	}
	return value, nil
}

// VerifyAgentKey asks whose an agent key is: an *solvapay.Error with status 401
// for an unknown or revoked key, 403 for another merchant's or the other
// environment's.
func (c *Client) VerifyAgentKey(ctx context.Context, agentKey string) (VerifiedAgentKey, error) {
	value, err := c.post(ctx, "/v1/sdk/agent/keys/verifications", map[string]string{"agentKey": agentKey}, requestTimeout)
	if err != nil {
		return VerifiedAgentKey{}, err
	}
	return parseVerifiedAgentKey(value)
}

// Authorize asks SolvaPay whether a paid call may go ahead. A held request
// answers when the owner does or its wait ends, so it may take that long.
func (c *Client) Authorize(ctx context.Context, input AuthorizeInput) (AuthorizeResponse, error) {
	timeout := time.Duration(input.Wait)*time.Second + requestTimeout
	value, err := c.post(ctx, "/v1/sdk/agent/calls", input, timeout)
	if err != nil {
		return AuthorizeResponse{}, err
	}
	return parseAuthorizeResponse(value)
}

// Complete settles a call at how the upstream answered.
func (c *Client) Complete(ctx context.Context, callRef string, input CompleteInput) (CompleteResponse, error) {
	segment, err := solvapay.PathSegment(callRef)
	if err != nil {
		return CompleteResponse{}, err
	}
	value, err := c.post(ctx, "/v1/sdk/agent/calls/"+segment+"/complete", input, requestTimeout)
	if err != nil {
		return CompleteResponse{}, err
	}
	return parseCompleteResponse(value)
}

// ReportUsage sends the merchant's usage for reconciliation.
func (c *Client) ReportUsage(ctx context.Context, report UsageReport) (UsageReportResponse, error) {
	value, err := c.post(ctx, "/v1/sdk/agent/usage-reports", report, requestTimeout)
	if err != nil {
		return UsageReportResponse{}, err
	}
	return parseUsageReportResponse(value)
}

// apiStatus is the HTTP status of an error the API answered with (400 and
// up), as TypeScript's AgentApiError carries; false for anything else (an
// unreadable answer, SolvaPay out of reach).
func apiStatus(err error) (int, bool) {
	var e *solvapay.Error
	if errors.As(err, &e) && e.Status >= 400 {
		return e.Status, true
	}
	return 0, false
}

// ---- reading answers field by field: a paid call goes ahead on them ----------

func unreadable(format string, args ...any) *solvapay.Error {
	return &solvapay.Error{Code: "invalid_response", Message: fmt.Sprintf(format, args...)}
}

func record(value any, label string) (map[string]any, error) {
	if m, ok := value.(map[string]any); ok {
		return m, nil
	}
	return nil, unreadable("%s was not an object", label)
}

func requireString(value any, label string) (string, error) {
	if s, ok := value.(string); ok && s != "" {
		return s, nil
	}
	return "", unreadable("%s must be a non-empty string", label)
}

func requireBool(value any, label string) (bool, error) {
	if b, ok := value.(bool); ok {
		return b, nil
	}
	return false, unreadable("%s must be a boolean", label)
}

func requireInteger(value any, label string) (int, error) {
	if f, ok := value.(float64); ok && f == float64(int(f)) {
		return int(f), nil
	}
	return 0, unreadable("%s must be an integer", label)
}

func requireOneOf(allowed []string, value any, label string) (string, error) {
	if s, ok := value.(string); ok && slices.Contains(allowed, s) {
		return s, nil
	}
	encoded, _ := json.Marshal(value)
	return "", unreadable("%s must be one of %s, got %s", label, strings.Join(allowed, ", "), encoded)
}

func parseMoney(value any, label string) (Money, error) {
	m, ok := value.(map[string]any)
	if !ok {
		return Money{}, unreadable("%s must be an object with amount and currency", label)
	}
	amount, err := requireString(m["amount"], label+".amount")
	if err != nil {
		return Money{}, err
	}
	currency, err := requireString(m["currency"], label+".currency")
	if err != nil {
		return Money{}, err
	}
	return Money{Amount: amount, Currency: currency}, nil
}

// fields reads several fields in order, stopping at the first that fails.
type fields struct{ err error }

func (f *fields) str(value any, label string) string {
	if f.err != nil {
		return ""
	}
	s, err := requireString(value, label)
	f.err = err
	return s
}

func (f *fields) boolean(value any, label string) bool {
	if f.err != nil {
		return false
	}
	b, err := requireBool(value, label)
	f.err = err
	return b
}

func (f *fields) oneOf(allowed []string, value any, label string) string {
	if f.err != nil {
		return ""
	}
	s, err := requireOneOf(allowed, value, label)
	f.err = err
	return s
}

func (f *fields) money(value any, label string) Money {
	if f.err != nil {
		return Money{}
	}
	m, err := parseMoney(value, label)
	f.err = err
	return m
}

func (f *fields) integer(value any, label string) int {
	if f.err != nil {
		return 0
	}
	i, err := requireInteger(value, label)
	f.err = err
	return i
}

func parseVerifiedAgentKey(value any) (VerifiedAgentKey, error) {
	m, err := record(value, "Agent key verification")
	if err != nil {
		return VerifiedAgentKey{}, err
	}
	var f fields
	out := VerifiedAgentKey{
		AgentRef:      f.str(m["agentRef"], "agentRef"),
		PrincipalRef:  f.str(m["principalRef"], "principalRef"),
		PromptExcerpt: f.boolean(m["promptExcerpt"], "promptExcerpt"),
		Environment:   Environment(f.oneOf([]string{string(Sandbox), string(Live)}, m["environment"], "environment")),
	}
	return out, f.err
}

func parseAuthorizeResponse(value any) (AuthorizeResponse, error) {
	m, err := record(value, "Authorize response")
	if err != nil {
		return AuthorizeResponse{}, err
	}
	var f fields
	out := AuthorizeResponse{CallRef: f.str(m["callRef"], "callRef")}
	out.Status = f.str(m["status"], "status")
	if f.err != nil {
		return AuthorizeResponse{}, f.err
	}
	switch out.Status {
	case StatusAllowed:
		reservation, ok := m["reservation"].(map[string]any)
		if !ok {
			return AuthorizeResponse{}, unreadable("reservation must be an object")
		}
		out.Reservation = &Reservation{
			Held:      f.money(reservation["held"], "reservation.held"),
			ExpiresAt: f.str(reservation["expiresAt"], "reservation.expiresAt"),
		}
	case StatusRefused:
		out.Reason = f.oneOf(serverRefusalReasons, m["reason"], "reason")
		out.Message = f.str(m["message"], "message")
	case StatusWaiting:
		out.Message = f.str(m["message"], "message")
		if f.err != nil {
			return AuthorizeResponse{}, f.err
		}
		approval, ok := m["approval"].(map[string]any)
		if !ok {
			return AuthorizeResponse{}, unreadable("approval must be an object")
		}
		out.Approval = &Approval{
			Reference: f.str(approval["reference"], "approval.reference"),
			ExpiresAt: f.str(approval["expiresAt"], "approval.expiresAt"),
		}
		out.RetryAfterSeconds = f.integer(m["retryAfterSeconds"], "retryAfterSeconds")
	default:
		return AuthorizeResponse{}, unreadable("Authorize status %q is not allowed, refused or waiting", out.Status)
	}
	if f.err != nil {
		return AuthorizeResponse{}, f.err
	}
	return out, nil
}

func parseCompleteResponse(value any) (CompleteResponse, error) {
	m, err := record(value, "Complete response")
	if err != nil {
		return CompleteResponse{}, err
	}
	var f fields
	out := CompleteResponse{
		CallRef:   f.str(m["callRef"], "callRef"),
		Settled:   f.boolean(m["settled"], "settled"),
		Source:    f.oneOf([]string{"reported", "provisional", "none"}, m["source"], "source"),
		Amount:    f.money(m["amount"], "amount"),
		Duplicate: f.boolean(m["duplicate"], "duplicate"),
	}
	if f.err != nil {
		return CompleteResponse{}, f.err
	}
	return out, nil
}

var (
	reconciliationResults = []string{"matched", "adjusted", "pending", "already_reconciled", "ignored"}
	reconciliationReasons = []string{"provisional", "expired", "no_debit", "cost_differs"}
)

func parseUsageReportResponse(value any) (UsageReportResponse, error) {
	m, err := record(value, "Usage report response")
	if err != nil {
		return UsageReportResponse{}, err
	}
	results, ok := m["results"].([]any)
	if !ok {
		return UsageReportResponse{}, unreadable("Usage report results must be a list")
	}
	untagged, ok := m["untagged"].(map[string]any)
	if !ok {
		return UsageReportResponse{}, unreadable("Usage report untagged must be an object")
	}
	var f fields
	out := UsageReportResponse{
		Reference: f.str(m["reference"], "reference"),
		Currency:  f.str(m["currency"], "currency"),
		Duplicate: f.boolean(m["duplicate"], "duplicate"),
	}
	for _, item := range results {
		call, err := record(item, "Usage report result")
		if err != nil {
			return UsageReportResponse{}, err
		}
		optional := func(field string) string {
			if call[field] == nil {
				return ""
			}
			return f.str(call[field], field)
		}
		reconciled := ReconciledCall{CallRef: optional("callRef")}
		reconciled.Result = f.oneOf(reconciliationResults, call["result"], "result")
		if call["reason"] != nil {
			reconciled.Reason = f.oneOf(reconciliationReasons, call["reason"], "reason")
		}
		reconciled.Reported = optional("reported")
		reconciled.BookedPolicy = optional("bookedPolicy")
		reconciled.BookedCredit = optional("bookedCredit")
		reconciled.PolicyDelta = optional("policyDelta")
		reconciled.CreditDelta = optional("creditDelta")
		out.Results = append(out.Results, reconciled)
	}
	out.Untagged.Total = f.str(untagged["total"], "untagged.total")
	out.Untagged.BeforePolicy = f.str(untagged["beforePolicy"], "untagged.beforePolicy")
	out.Untagged.Flagged = f.boolean(untagged["flagged"], "untagged.flagged")
	if f.err != nil {
		return UsageReportResponse{}, f.err
	}
	return out, nil
}
