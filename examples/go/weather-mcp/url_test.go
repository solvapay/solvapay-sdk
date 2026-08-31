package main

import "testing"

func TestRequirePublicBaseURLRejectsMissing(t *testing.T) {
	t.Setenv("MCP_PUBLIC_BASE_URL", "")
	_, err := requirePublicBaseURL()
	if err == nil {
		t.Fatal("expected error for missing MCP_PUBLIC_BASE_URL")
	}
}

func TestRequirePublicBaseURLRejectsMalformed(t *testing.T) {
	t.Setenv("MCP_PUBLIC_BASE_URL", "http://weathermcp.example.test")
	_, err := requirePublicBaseURL()
	if err == nil {
		t.Fatal("expected error for non-https MCP_PUBLIC_BASE_URL")
	}
}

func TestRequirePublicBaseURLAcceptsHTTPSOrigin(t *testing.T) {
	t.Setenv("MCP_PUBLIC_BASE_URL", "https://weathermcp.example.test")
	got, err := requirePublicBaseURL()
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://weathermcp.example.test" {
		t.Fatalf("got %q", got)
	}
}

func TestValidatePublicBaseURL(t *testing.T) {
	cases := []struct {
		url     string
		wantErr bool
	}{
		{url: "https://weathermcp.example.test", wantErr: false},
		{url: "http://weathermcp.example.test", wantErr: true},
		{url: "https://weathermcp.example.test/", wantErr: true},
		{url: "https://weathermcp.example.test/mcp", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.url, func(t *testing.T) {
			err := validatePublicBaseURL(tc.url)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
