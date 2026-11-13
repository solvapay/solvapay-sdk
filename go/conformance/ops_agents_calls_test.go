package conformance

// Suite agent-calls: an agent's paid call (authorize, upstream, complete). A
// scenario whose setup has agentCalls runs against ONE agents.Calls, so the
// Allowed handle beginCall returns is what later finishCall / releaseCall
// steps act on. Mirrors conformance/runners/typescript/src/agent-calls.ts and
// python/conformance_runner/agent_calls_runner.py:
//
//   - Time is virtual: each step starts at its clock, and waiting for the owner
//     advances it by the retryAfterSeconds SolvaPay asked for, without
//     sleeping. clientGoneAfterSeconds makes the caller go away (its context
//     ends) that many seconds into the step.
//   - The API answers from the step's api list; every request is compared,
//     with its body.
//   - The step's result is { outcome, log }: what the SDK returned, and every
//     log line (event and fields, without error, whose text is for people).

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go/agents"
)

// logCapture is an slog handler keeping each line as { event, fields }.
type logCapture struct{ lines *[]any }

func (c logCapture) Enabled(context.Context, slog.Level) bool { return true }

func (c logCapture) Handle(_ context.Context, record slog.Record) error {
	fields := map[string]any{}
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key != "error" {
			fields[attr.Key] = attr.Value.Any()
		}
		return true
	})
	*c.lines = append(*c.lines, map[string]any{"event": record.Message, "fields": fields})
	return nil
}

func (c logCapture) WithAttrs([]slog.Attr) slog.Handler { return c }
func (c logCapture) WithGroup(string) slog.Handler      { return c }

func init() {
	scenarioRunners = append(scenarioRunners, runAgentCallsScenario)
}

func runAgentCallsScenario(t *testing.T, data map[string]any) ([]any, bool) {
	setup, _ := data["setup"].(map[string]any)
	config, ok := setup["agentCalls"].(map[string]any)
	if !ok {
		return nil, false
	}
	stub := &apiStub{t: t}
	var (
		now    time.Time
		lines  []any
		goneAt *time.Time
		leave  context.CancelFunc
	)
	session, err := agents.NewCalls(agents.CallsOptions{
		Client:         agentClient(t, stub),
		MaxWaitSeconds: int(number(t, config["maxWaitSeconds"])),
		Logger:         slog.New(logCapture{lines: &lines}),
		Now:            func() time.Time { return now },
		Sleep: func(ctx context.Context, d time.Duration) {
			if goneAt != nil && ctx.Err() == nil && !goneAt.After(now.Add(d)) {
				if goneAt.After(now) {
					now = *goneAt
				}
				leave()
				return
			}
			now = now.Add(d)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]*agents.Allowed{}

	runStep := func(fn string, args map[string]any) any {
		switch fn {
		case "beginCall":
			var agent struct {
				AgentRef      string `json:"agentRef"`
				PrincipalRef  string `json:"principalRef"`
				PromptExcerpt bool   `json:"promptExcerpt"`
				Environment   string `json:"environment"`
			}
			remarshal(t, args["agent"], &agent)
			var estimate agents.Money
			remarshal(t, args["estimate"], &estimate)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			goneAt, leave = nil, cancel
			if after, ok := args["clientGoneAfterSeconds"]; ok {
				at := now.Add(time.Duration(number(t, after) * float64(time.Second)))
				goneAt = &at
				if number(t, after) == 0 {
					cancel()
				}
			}
			call := agents.AgentCall{
				RequestID:  str(args, "requestId"),
				AgentToken: str(args, "agentToken"),
				Agent: agents.VerifiedAgent{
					AgentRef:      agent.AgentRef,
					PrincipalRef:  agent.PrincipalRef,
					PromptExcerpt: agent.PromptExcerpt,
					Environment:   agents.Environment(agent.Environment),
				},
				Item:     str(args, "item"),
				Estimate: estimate,
			}
			if prompt, ok := args["prompt"].(map[string]any); ok {
				toolError, _ := prompt["toolError"].(bool)
				facts := agents.NewPromptFacts(prompt["text"].(string), toolError)
				call.Prompt = &facts
			}
			if fields, ok := args["logFields"].(map[string]any); ok {
				call.LogFields = fields
			}
			begun, refused := session.Begin(ctx, call)
			if refused != nil {
				return map[string]any{"kind": "refused", "reason": refused.Reason, "message": refused.Message}
			}
			allowed[call.RequestID] = begun
			return map[string]any{
				"kind":        "allow",
				"callRef":     begun.CallRef,
				"item":        begun.Item,
				"estimate":    begun.Estimate,
				"reservation": begun.Reservation,
			}
		case "finishCall", "releaseCall":
			handle := allowed[str(args, "requestId")]
			if handle == nil {
				t.Fatalf("no allowed call for requestId %v", args["requestId"])
			}
			if fn == "releaseCall" {
				if err := handle.Release(context.Background(), str(args, "reason")); err != nil {
					// Completing a call twice fails; the message is for people.
					return "threw"
				}
				return nil
			}
			result := agents.CallResult{Status: int(number(t, args["status"])), Interrupted: str(args, "interrupted")}
			if cost, ok := args["cost"].(map[string]any); ok {
				result.Cost = &agents.Cost{Amount: number(t, cost["amount"]), Currency: str(cost, "currency")}
			}
			completed, err := handle.Finish(context.Background(), result)
			if err != nil {
				return "threw"
			}
			if completed == nil {
				return nil
			}
			return completed
		}
		t.Fatalf("no Go mapping for agent-calls step %q", fn)
		return nil
	}

	var outcomes []any
	for i, item := range data["steps"].([]any) {
		step := item.(map[string]any)
		now = parseClock(t, step["clock"].(string))
		stub.script(step["api"])
		lines = []any{}
		outcome := runStep(step["fn"].(string), step["args"].(map[string]any))
		if unused := stub.unused(); len(unused) > 0 {
			t.Fatalf("step %d (%v): API exchanges not used: %v", i+1, step["fn"], unused)
		}
		outcomes = append(outcomes, map[string]any{
			"result":   map[string]any{"outcome": outcome, "log": lines},
			"apiCalls": stub.recorded(),
		})
	}
	return outcomes, true
}
