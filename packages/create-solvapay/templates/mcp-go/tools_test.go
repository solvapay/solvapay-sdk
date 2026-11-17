package main

import "testing"

func TestAnswerReturnsTheQuery(t *testing.T) {
	if got := answer("weather in Oslo")["query"]; got != "weather in Oslo" {
		t.Fatalf("query = %v", got)
	}
}

func TestAboutNamesThePaidTool(t *testing.T) {
	if got := about()["paid"]; got != "__TOOL_NAME__" {
		t.Fatalf("paid = %v", got)
	}
}
