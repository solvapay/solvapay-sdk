package agents

// One agent's paid call, start to finish, whatever the protocol: an HTTP
// route and an MCP tool run it the same way, and each turns a refusal into its
// own wire format.
//
// SolvaPay decides everything: authorize before the upstream call finds the
// customer, checks the spend policy, holds the estimate against the budget
// and the balance, and waits for the owner when they must approve; complete
// after it settles at the cost the upstream reported. This file only drives
// those two requests.

import (
	"context"
	"log/slog"
	"math"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// RefusalReason is why a call was refused: one of SolvaPay's own
// (customer_not_linked, ask, deny, topup_required, approval_declined,
// approval_expired), or agent_not_accepted, approval_timed_out,
// approval_client_closed, unavailable.
type RefusalReason = string

const (
	// ReasonAgentNotAccepted: SolvaPay did not accept the agent token (revoked, or not for this merchant).
	ReasonAgentNotAccepted RefusalReason = "agent_not_accepted"
	// ReasonApprovalTimedOut: the owner had not answered when this merchant stopped waiting.
	ReasonApprovalTimedOut RefusalReason = "approval_timed_out"
	// ReasonApprovalClientClosed: the caller went away while the owner was deciding.
	ReasonApprovalClientClosed RefusalReason = "approval_client_closed"
	// ReasonUnavailable: SolvaPay could not be reached or answered with an error; never let through.
	ReasonUnavailable RefusalReason = "unavailable"
)

const (
	notAccepted = "SolvaPay did not accept this agent (revoked or not for this merchant)."
	unavailable = "SolvaPay could not be reached to authorize this call. Try again shortly."
)

// CallClient is the part of Client that calls use.
type CallClient interface {
	Authorize(ctx context.Context, input AuthorizeInput) (AuthorizeResponse, error)
	Complete(ctx context.Context, callRef string, input CompleteInput) (CompleteResponse, error)
}

// AgentCall is one paid call to authorize.
type AgentCall struct {
	// RequestID is the merchant's id for the call; SolvaPay keys the call on it.
	RequestID string
	// AgentToken is the token as presented: SolvaPay verifies it again.
	AgentToken string
	Agent      VerifiedAgent
	// Item is the merchant's label for what is used (a model id, a tool name).
	Item string
	// Estimate is what this call may cost, in the merchant's currency.
	Estimate Money
	Prompt   *PromptFacts
	// LogFields are added to every log line about this call, for example the route or the tool.
	LogFields map[string]any
}

// Refused is a refused call. Message is the sentence for the human, in every case.
type Refused struct {
	Reason  RefusalReason
	Message string
}

// Cost is what the upstream reported a call cost, in its currency.
type Cost struct {
	Amount   float64
	Currency string
}

// CallResult is how the upstream answered, as the merchant read it.
type CallResult struct {
	Status int
	// Cost is nil when none arrived.
	Cost *Cost
	// Interrupted is set when the answer to the caller broke before it finished.
	Interrupted string
}

// CallsOptions configures Calls.
type CallsOptions struct {
	Client CallClient
	// MaxWaitSeconds is how long a call may wait for its owner's answer; 0 refuses at once.
	MaxWaitSeconds int
	// Logger gets one line per event; nil means slog.Default().
	Logger *slog.Logger
	// Now is the clock; nil means time.Now.
	Now func() time.Time
	// Sleep waits between authorize requests, returning early when ctx ends;
	// nil waits on a timer.
	Sleep func(ctx context.Context, d time.Duration)
}

// Calls authorizes agent calls with SolvaPay, waiting up to MaxWaitSeconds
// for the owner.
type Calls struct {
	options CallsOptions
}

// NewCalls builds Calls.
func NewCalls(options CallsOptions) (*Calls, error) {
	if options.Client == nil {
		return nil, &solvapay.Error{Code: "invalid_argument", Message: "Agent calls need a Client"}
	}
	if options.MaxWaitSeconds < 0 {
		return nil, &solvapay.Error{Code: "invalid_argument", Message: "MaxWaitSeconds cannot be negative"}
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.Sleep == nil {
		options.Sleep = sleepOrDone
	}
	return &Calls{options: options}, nil
}

func sleepOrDone(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

// Allowed is a call that may go ahead. Finish it once, when the upstream has
// answered, or Release it when the upstream was never reached.
type Allowed struct {
	// CallRef is SolvaPay's reference for the call: tag the upstream usage with it.
	CallRef  string
	Item     string
	Estimate Money
	// Reservation is what SolvaPay holds for the call, in USD credits.
	Reservation Reservation

	calls     *Calls
	call      AgentCall
	mu        sync.Mutex
	completed bool
}

// Begin authorizes a call: allowed (the *Allowed), or refused with why (the
// *Refused); exactly one is non-nil. ctx ending (the caller gone) ends a wait
// for the owner, but never an authorize already sent.
func (c *Calls) Begin(ctx context.Context, call AgentCall) (*Allowed, *Refused) {
	o := c.options
	deadline := o.Now().Add(time.Duration(o.MaxWaitSeconds) * time.Second)
	api := context.WithoutCancel(ctx)
	for {
		left := deadline.Sub(o.Now()).Milliseconds()
		wait := max(0, min(AuthorizeWaitMaxSeconds, int(floorDiv(left, 1000))))
		input := AuthorizeInput{
			AgentToken: call.AgentToken,
			RequestID:  call.RequestID,
			Item:       call.Item,
			Estimate:   call.Estimate,
			Wait:       wait,
		}
		if facts := call.Prompt; facts != nil {
			input.PromptHash = facts.PromptHash
			input.ToolError = &facts.ToolError
			// Only when the token SolvaPay minted says the owner opted in.
			if call.Agent.PromptExcerpt {
				input.PromptExcerpt = &facts.Excerpt
			}
		}
		answer, err := o.Client.Authorize(api, input)
		if err != nil {
			status, fromAPI := apiStatus(err)
			fields := c.fields(call)
			fields["status"] = nullable(status, fromAPI)
			fields["error"] = err.Error()
			c.log(slog.LevelError, "call.authorize_failed", fields)
			// SolvaPay verifies the token again: a revoked agent, or one for another
			// merchant or the other environment. A refusal of the merchant (agent
			// payments off, a secret key for the other environment) is not the
			// agent's: unavailable, logged above.
			if _, agents := AgentRefusal(err); agents {
				return nil, c.refuse(call, ReasonAgentNotAccepted, notAccepted, nil)
			}
			return nil, c.refuse(call, ReasonUnavailable, unavailable, nil)
		}
		switch answer.Status {
		case StatusAllowed:
			fields := c.fields(call)
			fields["callRef"] = answer.CallRef
			c.log(slog.LevelInfo, "call.allowed", fields)
			return &Allowed{
				CallRef:     answer.CallRef,
				Item:        call.Item,
				Estimate:    call.Estimate,
				Reservation: *answer.Reservation,
				calls:       c,
				call:        call,
			}, nil
		case StatusRefused:
			return nil, c.refuse(call, answer.Reason, answer.Message, map[string]any{"callRef": answer.CallRef})
		}
		held := map[string]any{"callRef": answer.CallRef, "approvalRef": answer.Approval.Reference}
		if o.MaxWaitSeconds == 0 {
			return nil, c.refuse(call, "ask", answer.Message, held)
		}
		if ctx.Err() != nil {
			return nil, c.refuse(call, ReasonApprovalClientClosed, answer.Message, held)
		}
		if !o.Now().Before(deadline) {
			return nil, c.refuse(call, ReasonApprovalTimedOut, answer.Message, held)
		}
		fields := c.fields(call)
		for k, v := range held {
			fields[k] = v
		}
		c.log(slog.LevelInfo, "call.waiting", fields)
		o.Sleep(ctx, time.Duration(answer.RetryAfterSeconds)*time.Second)
	}
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

func nullable(status int, ok bool) any {
	if ok {
		return status
	}
	return nil
}

func (c *Calls) refuse(call AgentCall, reason RefusalReason, message string, extra map[string]any) *Refused {
	fields := c.fields(call)
	fields["reason"] = reason
	for k, v := range extra {
		fields[k] = v
	}
	c.log(slog.LevelInfo, "call.refused", fields)
	return &Refused{Reason: reason, Message: message}
}

// fields is every log line's fields about a call, the merchant's LogFields
// among them (the SDK's own win a clash, as in TypeScript).
func (c *Calls) fields(call AgentCall) map[string]any {
	out := map[string]any{"requestId": call.RequestID}
	for k, v := range call.LogFields {
		out[k] = v
	}
	out["agentRef"] = call.Agent.AgentRef
	out["userRef"] = call.Agent.PrincipalRef
	out["item"] = call.Item
	out["estimate"] = call.Estimate.Amount + " " + call.Estimate.Currency
	return out
}

func (c *Calls) log(level slog.Level, event string, fields map[string]any) {
	logEvent(c.options.Logger, level, event, fields)
}

// logEvent writes one line: the event as the message and each field as an
// attribute, in key order. Never pass keys or secrets in fields.
func logEvent(logger *slog.Logger, level slog.Level, event string, fields map[string]any) {
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	attrs := make([]slog.Attr, len(keys))
	for i, k := range keys {
		attrs[i] = slog.Any(k, fields[k])
	}
	logger.LogAttrs(context.Background(), level, event, attrs...)
}

// Finish completes the call at how the upstream answered. It returns nil when
// SolvaPay could not be told (logged; the reservation lapses at the
// estimate), and an error only when the call was already completed or the
// cost is not a finite number.
func (a *Allowed) Finish(ctx context.Context, result CallResult) (*CompleteResponse, error) {
	input := CompleteInput{Status: result.Status, Interrupted: result.Interrupted}
	if result.Cost != nil {
		amount, err := AmountString(result.Cost.Amount)
		if err != nil {
			return nil, err
		}
		input.Cost = &Money{Amount: amount, Currency: result.Cost.Currency}
	}
	return a.complete(ctx, input)
}

// Release completes a call that never reached the upstream as an upstream
// failure, so nothing is charged.
func (a *Allowed) Release(ctx context.Context, reason string) error {
	_, err := a.complete(ctx, CompleteInput{Status: 502, Cost: nil, Interrupted: reason})
	return err
}

func (a *Allowed) complete(ctx context.Context, input CompleteInput) (*CompleteResponse, error) {
	a.mu.Lock()
	done := a.completed
	a.completed = true
	a.mu.Unlock()
	if done {
		return nil, &solvapay.Error{Code: "call_completed", Message: "Call " + a.CallRef + " was already completed"}
	}
	answer, err := a.calls.options.Client.Complete(context.WithoutCancel(ctx), a.CallRef, input)
	if err != nil {
		status, fromAPI := apiStatus(err)
		fields := a.calls.fields(a.call)
		fields["callRef"] = a.CallRef
		fields["status"] = nullable(status, fromAPI)
		fields["error"] = err.Error()
		a.calls.log(slog.LevelError, "call.complete_failed", fields)
		return nil, nil
	}
	return &answer, nil
}

// AmountString writes an amount as a decimal string with up to 8 places,
// trailing zeros trimmed, as JavaScript's toFixed(8) rounds it: from the
// number's exact binary value, a tie away from zero. From 1e21 up it is the
// integer's plain digits (toFixed would switch to exponent notation).
func AmountString(amount float64) (string, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return "", &solvapay.Error{Code: "invalid_argument", Message: "A cost must be a finite number"}
	}
	if math.Abs(amount) >= 1e21 {
		integer, _ := new(big.Float).SetFloat64(amount).Int(nil) // exact: no fraction this large
		return integer.String(), nil
	}
	sign := ""
	if amount < 0 {
		sign = "-"
	}
	// n = floor(x × 10^8 + 1/2), exactly, then n / 10^8 with 8 places.
	scaled := new(big.Rat).SetFloat64(math.Abs(amount))
	scaled.Mul(scaled, new(big.Rat).SetInt64(100_000_000))
	scaled.Add(scaled, big.NewRat(1, 2))
	n := new(big.Int).Quo(scaled.Num(), scaled.Denom())
	digits := n.String()
	if len(digits) < 9 {
		digits = strings.Repeat("0", 9-len(digits)) + digits
	}
	fixed := sign + digits[:len(digits)-8] + "." + digits[len(digits)-8:]
	fixed = strings.TrimRight(fixed, "0")
	fixed = strings.TrimSuffix(fixed, ".")
	if fixed == "" {
		return "0", nil
	}
	return fixed, nil
}
