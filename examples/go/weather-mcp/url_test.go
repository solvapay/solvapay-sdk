package main

import "testing"

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
