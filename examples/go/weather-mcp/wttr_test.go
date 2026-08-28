package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeReportParsesStringNumerics(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("fixtures", "wttr-london.json"))
	if err != nil {
		t.Fatal(err)
	}
	report, err := decodeReport(raw)
	if err != nil {
		t.Fatal(err)
	}
	if report.Current.TempC != 12 {
		t.Fatalf("TempC = %d, want 12", report.Current.TempC)
	}
	if report.Current.Condition != "Partly cloudy" {
		t.Fatalf("Condition = %q, want %q", report.Current.Condition, "Partly cloudy")
	}
}

func TestDecodeReportRejectsEmptyCurrentCondition(t *testing.T) {
	_, err := decodeReport([]byte(`{"current_condition":[]}`))
	if err == nil {
		t.Fatal("expected error for empty current_condition")
	}
}
