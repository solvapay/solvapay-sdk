package solvapay_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	solvapay "github.com/solvapay/solvapay-sdk/sdks/go"
)

func TestBuildInfoStamp(t *testing.T) {
	raw, err := solvapay.BuildInfo(context.Background())
	if err != nil {
		t.Fatalf("BuildInfo: %v", err)
	}
	var info struct {
		Version string `json:"version"`
		CoreSha string `json:"coreSha"`
	}
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		t.Fatalf("BuildInfo JSON: %v", err)
	}
	if info.Version != "0.1.0" {
		t.Fatalf("version = %q, want 0.1.0", info.Version)
	}
	if info.CoreSha == "" {
		t.Fatal("coreSha must be non-empty")
	}
	if os.Getenv("SOLVAPAY_RELEASE_VERSION") != "" && info.CoreSha == "unknown" {
		t.Fatal("release builds must stamp a non-unknown coreSha")
	}
}
