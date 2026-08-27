package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestReplaysCoreOps(t *testing.T) {
	root := lookupMcpFixtures(t)
	ctx := context.Background()
	for _, rel := range coreOpFixtures() {
		t.Run(rel, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
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
			if env.Input.Fn == "registerPayable" || env.Input.Fn == "mcpBootstrap" {
				t.Fatal("coreOpFixtures should not include host-only ops")
			}
			var args any
			if len(env.Input.Args) > 0 {
				if err := json.Unmarshal(env.Input.Args, &args); err != nil {
					t.Fatal(err)
				}
			} else {
				args = map[string]any{}
			}
			gotRaw, err := CallSync(ctx, env.Input.Fn, args)
			if err != nil {
				t.Fatalf("CallSync: %v", err)
			}
			var got any
			if err := json.Unmarshal(gotRaw, &got); err != nil {
				t.Fatal(err)
			}
			var want any
			if err := json.Unmarshal(env.Expect.Result, &want); err != nil {
				t.Fatal(err)
			}
			if env.Input.Fn == "mcpHandleRequest" && strings.HasSuffix(rel, "tools-list.json") {
				gotMap, _ := got.(map[string]any)
				if gotMap["kind"] != "rpc" {
					t.Fatalf("kind = %v", gotMap["kind"])
				}
				rpc, _ := gotMap["rpc"].(map[string]any)
				result, _ := rpc["result"].(map[string]any)
				tools, _ := result["tools"].([]any)
				if len(tools) < 8 {
					t.Fatalf("tools len = %d", len(tools))
				}
				return
			}
			if env.Input.Fn == "mcpHandleRequest" && strings.HasSuffix(rel, "invoke-handler.json") {
				gotMap, _ := got.(map[string]any)
				wantMap, _ := want.(map[string]any)
				if gotMap["kind"] != "invokeHandler" {
					t.Fatalf("kind = %v", gotMap["kind"])
				}
				if gotMap["tool"] != wantMap["tool"] || !reflect.DeepEqual(gotMap["args"], wantMap["args"]) || gotMap["customerRef"] != wantMap["customerRef"] {
					t.Fatalf("invokeHandler mismatch\ngot %#v\nwant %#v", gotMap, wantMap)
				}
				token, _ := gotMap["token"].(string)
				if len(token) < 8 {
					t.Fatalf("token too short: %q", token)
				}
				return
			}
			if !reflect.DeepEqual(got, want) {
				g, _ := json.MarshalIndent(got, "", "  ")
				w, _ := json.MarshalIndent(want, "", "  ")
				t.Fatalf("mismatch\ngot:\n%s\nwant:\n%s", g, w)
			}
		})
	}
}
