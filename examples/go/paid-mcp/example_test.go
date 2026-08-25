package main

import (
	"context"
	"strings"
	"testing"
)

func TestAllowRoundTrip(t *testing.T) {
	result, err := run(context.Background(), true, "hello")
	if err != nil {
		t.Fatal(err)
	}
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatal("missing content")
	}
	block, _ := content[0].(map[string]any)
	if block["text"] != `{"echo":"hello"}` {
		t.Fatalf("text = %v", block["text"])
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["echo"] != "hello" {
		t.Fatalf("structuredContent = %v", result["structuredContent"])
	}
}

func TestGateRoundTrip(t *testing.T) {
	result, err := run(context.Background(), false, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if result["isError"] != false {
		t.Fatalf("isError = %v", result["isError"])
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["kind"] != "payment_required" {
		t.Fatalf("kind = %v", sc["kind"])
	}
	content, _ := result["content"].([]any)
	block, _ := content[0].(map[string]any)
	text, _ := block["text"].(string)
	if text == "" || !strings.Contains(text, "upgrade") {
		t.Fatalf("gate text = %q", text)
	}
}
