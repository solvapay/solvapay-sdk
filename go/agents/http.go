package agents

// SolvaPay agent payments for an HTTP API. The gate reads the presented key: a
// SolvaPay agent token is verified and the call authorized; anything else is
// left to the merchant's own auth. The merchant forwards an allowed call, then
// completes it with the cost the upstream reported (Allowed.Finish), or
// releases it when the upstream was never reached (Allowed.Release).

import (
	"context"
	"log/slog"
	"net/http"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// RefusalStatus is the HTTP status for a refusal: 402 for anything money or
// the owner can settle (link the account, top up, approve), so a client shows
// the reason instead of retrying; 422 for a policy deny; 401 for an agent
// SolvaPay did not accept; 502 when SolvaPay could not be reached. A reason
// it doesn't know is an error with code unknown_refusal_reason.
func RefusalStatus(reason RefusalReason) (int, error) {
	switch reason {
	case ReasonAgentNotAccepted:
		return http.StatusUnauthorized, nil
	case ReasonUnavailable:
		return http.StatusBadGateway, nil
	case "deny":
		return http.StatusUnprocessableEntity, nil
	case "customer_not_linked", "topup_required", "ask", "approval_declined", "approval_expired",
		ReasonApprovalTimedOut, ReasonApprovalClientClosed:
		return http.StatusPaymentRequired, nil
	}
	return 0, &solvapay.Error{Code: "unknown_refusal_reason", Message: "Refusal reason " + reason + " has no status"}
}

// GateKind is what the gate decided.
type GateKind string

const (
	// GateNotAgent: not a SolvaPay agent credential; the merchant's own auth decides.
	GateNotAgent GateKind = "not_agent"
	// GateRejected: an agent token or key that did not verify: 401, or 403 from the other environment.
	GateRejected GateKind = "rejected"
	// GateRefused: SolvaPay refused the call.
	GateRefused GateKind = "refused"
	// GateAllowed: the call may go ahead.
	GateAllowed GateKind = "allowed"
)

// GateResult is the gate's decision. Status is set for GateRejected and
// GateRefused; Challenge, with a ProtectedResource, on a 401.
type GateResult struct {
	Kind      GateKind
	Status    int
	Rejection *Rejection
	Refused   *Refused
	Allowed   *Allowed
	Agent     *VerifiedAgent
	Challenge http.Header
}

// GateCall is one call through the gate.
type GateCall struct {
	// PresentedKey is the key the caller presented (bearer token or API key header).
	PresentedKey string
	RequestID    string
	Item         string
	Estimate     Money
	Prompt       *PromptFacts
	LogFields    map[string]any
}

// Gate authorizes agents' calls to an HTTP API.
type Gate struct {
	Layer  *AgentLayer
	Calls  *Calls
	Logger *slog.Logger
	// ProtectedResource turns the OAuth challenge on: 401 results carry the
	// headers that send a host to sign in.
	ProtectedResource *ProtectedResource
}

// Check decides one call. ctx ending (the caller gone) ends a wait for the
// owner. The error is SolvaPay failing while an agent key was checked, or a
// ProtectedResource that cannot be one.
func (g *Gate) Check(ctx context.Context, call GateCall) (GateResult, error) {
	identity, err := g.Layer.Identify(ctx, call.PresentedKey)
	if err != nil {
		return GateResult{}, err
	}
	switch identity.Kind {
	case KindNotAgent:
		return GateResult{Kind: GateNotAgent}, nil
	case KindRejected:
		fields := map[string]any{"requestId": call.RequestID}
		for k, v := range call.LogFields {
			fields[k] = v
		}
		fields["reason"] = "agent_token_" + string(identity.Rejection.Reason)
		fields["detail"] = identity.Rejection.Detail
		logEvent(g.logger(), slog.LevelInfo, "call.rejected", fields)
		result := GateResult{Kind: GateRejected, Status: http.StatusUnauthorized, Rejection: identity.Rejection}
		if identity.Rejection.Reason == EnvironmentMismatch {
			result.Status = http.StatusForbidden
			return result, nil
		}
		result.Challenge, err = g.challenge("The agent token was not accepted: sign in again")
		return result, err
	}
	allowed, refused := g.Calls.Begin(ctx, AgentCall{
		RequestID:  call.RequestID,
		AgentToken: call.PresentedKey,
		Agent:      *identity.Agent,
		Item:       call.Item,
		Estimate:   call.Estimate,
		Prompt:     call.Prompt,
		LogFields:  call.LogFields,
	})
	if refused != nil {
		status, err := RefusalStatus(refused.Reason)
		if err != nil {
			return GateResult{}, err
		}
		result := GateResult{Kind: GateRefused, Status: status, Refused: refused, Agent: identity.Agent}
		if status == http.StatusUnauthorized {
			result.Challenge, err = g.challenge(refused.Message)
		}
		return result, err
	}
	return GateResult{Kind: GateAllowed, Allowed: allowed, Agent: identity.Agent}, nil
}

func (g *Gate) logger() *slog.Logger {
	if g.Logger == nil {
		return slog.Default()
	}
	return g.Logger
}

func (g *Gate) challenge(description string) (http.Header, error) {
	if g.ProtectedResource == nil {
		return nil, nil
	}
	return g.ProtectedResource.ChallengeHeaders(description)
}

// WriteRefusal answers a refusal as plain JSON, for a merchant with no error
// format of its own: {"error": {"type", "message"}}. Pass the gate's Challenge
// and a 401 carries it, so a host signs in again.
func WriteRefusal(w http.ResponseWriter, refused Refused, challenge http.Header) error {
	status, err := RefusalStatus(refused.Reason)
	if err != nil {
		return err
	}
	if status == http.StatusUnauthorized {
		for name, values := range challenge {
			w.Header()[name] = values
		}
	}
	writeJSON(w, status, map[string]any{"error": map[string]any{"type": refused.Reason, "message": refused.Message}})
	return nil
}
