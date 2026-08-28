package main

import (
	"context"
	"testing"
)

func TestCurrentWeatherToolReturnsStructuredWeather(t *testing.T) {
	result, err := runDemo(context.Background(), demoOptions{
		withinLimits: true,
		city:         "London",
	})
	if err != nil {
		t.Fatal(err)
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["temperatureC"] != float64(12) {
		t.Fatalf("temperatureC = %v", sc["temperatureC"])
	}
	condition, _ := sc["condition"].(string)
	if condition == "" {
		t.Fatal("expected non-empty condition")
	}
}

func TestCurrentWeatherToolReturnsPaywallWhenOverLimit(t *testing.T) {
	result, err := runDemo(context.Background(), demoOptions{
		withinLimits: false,
		city:         "London",
	})
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
}

func TestForecastToolReturnsThreeDays(t *testing.T) {
	result, err := runDemo(context.Background(), demoOptions{
		withinLimits: true,
		city:         "London",
		tool:         toolForecast,
	})
	if err != nil {
		t.Fatal(err)
	}
	sc, _ := result["structuredContent"].(map[string]any)
	days, _ := sc["days"].([]any)
	if len(days) != 3 {
		t.Fatalf("days len = %d, want 3", len(days))
	}
	first, _ := days[0].(map[string]any)
	if first["minC"] != float64(8) {
		t.Fatalf("minC = %v, want 8", first["minC"])
	}
	if first["maxC"] != float64(14) {
		t.Fatalf("maxC = %v, want 14", first["maxC"])
	}
	if first["sunrise"] != "06:42 AM" {
		t.Fatalf("sunrise = %v", first["sunrise"])
	}
}

func TestBlankCityIsAHandlerErrorNotAPaywall(t *testing.T) {
	result, err := runDemo(context.Background(), demoOptions{
		withinLimits: true,
		city:         "   ",
	})
	if err != nil {
		t.Fatal(err)
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if kind, _ := sc["kind"].(string); kind == "payment_required" {
		t.Fatal("blank city must not look like a billing problem")
	}
	if result["isError"] != true {
		t.Fatalf("isError = %v, want true", result["isError"])
	}
}
