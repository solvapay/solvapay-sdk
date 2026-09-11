package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAdapterAuthoredGateCopyFailsFixtures(t *testing.T) {
	root := lookupMcpFixtures(t)
	prev := formatGate
	t.Cleanup(func() { formatGate = prev })
	formatGate = func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{"content":[{"type":"text","text":"adapter-authored"}],"isError":false,"structuredContent":{"kind":"payment_required"}}`), nil
	}
	for _, rel := range []string{
		"gate/payment-required.json",
		"gate/activation-required.json",
		"gate/handler-invoked.json",
	} {
		t.Run(rel, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
			if err != nil {
				t.Fatal(err)
			}
			var env struct {
				Input struct {
					Args json.RawMessage `json:"args"`
				} `json:"input"`
				Expect struct {
					Result json.RawMessage `json:"result"`
				} `json:"expect"`
			}
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatal(err)
			}
			sc, err := parseScenario(env.Input.Args)
			if err != nil {
				t.Fatal(err)
			}
			obs, err := parseObservation(env.Expect.Result)
			if err != nil {
				t.Fatal(err)
			}
			backend := newMockBackend(sc.Limits)
			toolResult, err := callRegisteredPayable(t, backend, sc)
			if err != nil {
				t.Fatalf("call: %v", err)
			}
			content, _ := toolResult["content"].([]any)
			if len(content) == 0 {
				t.Fatal("missing content")
			}
			block, _ := content[0].(map[string]any)
			if block["text"] != "adapter-authored" {
				t.Fatalf("text = %v", block["text"])
			}
			if toolResultsEqual(toolResult, obs.ToolResult) {
				t.Fatal("adapter-authored copy must not match layer-2 fixture")
			}
		})
	}
}
