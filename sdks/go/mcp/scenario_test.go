package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type toolScenario struct {
	Name        string         `json:"name"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Args        map[string]any `json:"args"`
}

type handlerSpec struct {
	Kind    string           `json:"kind"`
	Data    json.RawMessage  `json:"data"`
	Options map[string]any   `json:"options"`
	Emit    []map[string]any `json:"emit"`
	Reason  string           `json:"reason"`
	Message string           `json:"message"`
}

type scenario struct {
	Tool              toolScenario   `json:"tool"`
	Product           string         `json:"product"`
	CustomerRef       string         `json:"customerRef"`
	CustomerRefSource string         `json:"customerRefSource"`
	Limits            map[string]any `json:"limits"`
	Handler           handlerSpec    `json:"handler"`
}

type usageProjection struct {
	Outcome     string         `json:"outcome"`
	ActionType  string         `json:"actionType"`
	Units       float64        `json:"units"`
	ProductRef  string         `json:"productRef"`
	CustomerRef string         `json:"customerRef"`
	Metadata    map[string]any `json:"metadata"`
}

type observation struct {
	ToolResult map[string]any    `json:"toolResult"`
	Usage      []usageProjection `json:"usage"`
}

func decodeStrict(raw []byte, dest any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	return nil
}

func parseScenario(args json.RawMessage) (scenario, error) {
	var sc scenario
	if err := decodeStrict(args, &sc); err != nil {
		return scenario{}, err
	}
	if sc.Tool.Name == "" {
		return scenario{}, fmt.Errorf("tool.name is required")
	}
	if sc.Product == "" {
		return scenario{}, fmt.Errorf("product is required")
	}
	if sc.CustomerRef == "" {
		return scenario{}, fmt.Errorf("customerRef is required")
	}
	if sc.CustomerRefSource != "hook" && sc.CustomerRefSource != "toolArgs" {
		return scenario{}, fmt.Errorf("customerRefSource must be hook or toolArgs")
	}
	if sc.Limits == nil {
		return scenario{}, fmt.Errorf("limits is required")
	}
	if _, ok := sc.Limits["withinLimits"]; !ok {
		return scenario{}, fmt.Errorf("limits.withinLimits is required")
	}
	switch sc.Handler.Kind {
	case "respond", "gate", "throw":
	default:
		return scenario{}, fmt.Errorf("handler.kind is required")
	}
	if sc.Tool.Args == nil {
		return scenario{}, fmt.Errorf("tool.args is required")
	}
	return sc, nil
}

func parseObservation(result json.RawMessage) (observation, error) {
	var obs observation
	if err := decodeStrict(result, &obs); err != nil {
		return observation{}, err
	}
	if obs.ToolResult == nil {
		return observation{}, fmt.Errorf("toolResult is required")
	}
	if _, ok := obs.ToolResult["content"]; !ok {
		return observation{}, fmt.Errorf("toolResult.content is required")
	}
	if obs.Usage == nil {
		return observation{}, fmt.Errorf("usage is required")
	}
	return obs, nil
}

func TestFixtureRoundTripsStrictSchema(t *testing.T) {
	root := lookupMcpFixtures(t)
	for _, rel := range registerPayableFixtures() {
		t.Run(rel, func(t *testing.T) {
			raw, err := os.ReadFile(root + "/" + rel)
			if err != nil {
				t.Fatal(err)
			}
			var env struct {
				Input struct {
					Fn   string          `json:"fn"`
					Args json.RawMessage `json:"args"`
				} `json:"input"`
				Expect struct {
					Result json.RawMessage `json:"result"`
				} `json:"expect"`
			}
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatal(err)
			}
			if env.Input.Fn != "registerPayable" {
				t.Fatalf("fn = %q", env.Input.Fn)
			}
			if _, err := parseScenario(env.Input.Args); err != nil {
				t.Fatalf("scenario: %v", err)
			}
			if _, err := parseObservation(env.Expect.Result); err != nil {
				t.Fatalf("observation: %v", err)
			}
		})
	}
}
