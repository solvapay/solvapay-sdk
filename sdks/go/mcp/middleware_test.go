package mcp

import (
	"context"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestHideToolsByAudienceFiltersUIForTextHosts(t *testing.T) {
	cases := []struct {
		name      string
		userAgent string
		wantUI    bool
	}{
		{"text host hides ui audience", "MCPJam/1.0", false},
		{"openai-mcp bypasses filter", "openai-mcp/1.0", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tools := []*mcpsdk.Tool{
				{Name: "upgrade", Meta: mcpsdk.Meta{}},
				{Name: "create_payment_intent", Meta: mcpsdk.Meta{"audience": "ui"}},
			}
			got, err := filterToolsByAudience(context.Background(), tools, []string{"ui"}, tc.userAgent)
			if err != nil {
				t.Fatal(err)
			}
			have := map[string]bool{}
			for _, tool := range got {
				have[tool.Name] = true
			}
			if !have["upgrade"] {
				t.Fatal("upgrade should remain")
			}
			if have["create_payment_intent"] != tc.wantUI {
				t.Fatalf("create_payment_intent present=%v want=%v", have["create_payment_intent"], tc.wantUI)
			}
		})
	}
}

func TestToolsListHidesUIAudienceByDefault(t *testing.T) {
	srv := newTestServer(t)
	session := connectTestSession(t, srv)
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range listed.Tools {
		if tool.Name == "create_payment_intent" {
			t.Fatal("text host should not see audience=ui tools")
		}
	}
}
