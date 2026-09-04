package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCurrentWeatherToolReturnsStructuredWeather(t *testing.T) {
	result := mustDemo(t, demoOptions{withinLimits: true, city: "London"})
	sc := structured(t, result)
	if sc["temperatureC"] != 21.1 {
		t.Fatalf("temperatureC = %v", sc["temperatureC"])
	}
	if sc["apparentTemperatureC"] != 20.1 {
		t.Fatalf("apparentTemperatureC = %v", sc["apparentTemperatureC"])
	}
	if sc["humidity"] != float64(58) {
		t.Fatalf("humidity = %v", sc["humidity"])
	}
	if sc["condition"] != weatherCodeText(3) {
		t.Fatalf("condition = %v", sc["condition"])
	}
	loc, _ := sc["location"].(map[string]any)
	if loc["name"] != "London" || loc["admin1"] != "England" {
		t.Fatalf("location = %#v", loc)
	}
}

func TestCurrentWeatherToolReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{withinLimits: false, city: "London"})
}

func TestBlankCityIsAHandlerErrorNotAPaywall(t *testing.T) {
	result := mustDemo(t, demoOptions{withinLimits: true, city: "   "})
	sc, _ := result["structuredContent"].(map[string]any)
	if kind, _ := sc["kind"].(string); kind == "payment_required" {
		t.Fatal("blank city must not look like a billing problem")
	}
	if result["isError"] != true {
		t.Fatalf("isError = %v, want true", result["isError"])
	}
}

func TestForecastToolDefaultsToThreeDays(t *testing.T) {
	result := mustDemo(t, demoOptions{withinLimits: true, city: "London", tool: toolForecast})
	sc := structured(t, result)
	days, _ := sc["days"].([]any)
	if len(days) != 3 {
		t.Fatalf("days len = %d, want 3", len(days))
	}
	first, _ := days[0].(map[string]any)
	if first["minC"] != 14.9 {
		t.Fatalf("minC = %v", first["minC"])
	}
	if first["maxC"] != 22.0 {
		t.Fatalf("maxC = %v", first["maxC"])
	}
	if first["sunrise"] != "2026-08-31T06:11" {
		t.Fatalf("sunrise = %v", first["sunrise"])
	}
}

func TestForecastToolRejectsDaysOutOfRange(t *testing.T) {
	for _, days := range []any{0, 17, -1} {
		result := mustDemo(t, demoOptions{
			withinLimits: true,
			tool:         toolForecast,
			args:         map[string]any{"city": "London", "days": days},
		})
		if result["isError"] != true {
			t.Fatalf("days=%v isError = %v", days, result["isError"])
		}
	}
}

func TestForecastToolReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{withinLimits: false, city: "London", tool: toolForecast})
}

func TestHourlyForecastToolDefaultsToTwelveHours(t *testing.T) {
	result := mustDemo(t, demoOptions{withinLimits: true, city: "London", tool: toolHourly})
	sc := structured(t, result)
	hours, _ := sc["hours"].([]any)
	if len(hours) != 12 {
		t.Fatalf("hours len = %d, want 12", len(hours))
	}
	first, _ := hours[0].(map[string]any)
	if first["temperatureC"] != 16.9 {
		t.Fatalf("temperatureC = %v", first["temperatureC"])
	}
}

func TestHourlyForecastToolRejectsHoursOutOfRange(t *testing.T) {
	for _, hours := range []any{0, 49} {
		result := mustDemo(t, demoOptions{
			withinLimits: true,
			tool:         toolHourly,
			args:         map[string]any{"city": "London", "hours": hours},
		})
		if result["isError"] != true {
			t.Fatalf("hours=%v isError = %v", hours, result["isError"])
		}
	}
}

func TestHourlyForecastToolReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{withinLimits: false, city: "London", tool: toolHourly})
}

func TestAirQualityToolReturnsReadings(t *testing.T) {
	result := mustDemo(t, demoOptions{withinLimits: true, city: "London", tool: toolAirQuality})
	sc := structured(t, result)
	if sc["europeanAqi"] != float64(31) {
		t.Fatalf("europeanAqi = %v", sc["europeanAqi"])
	}
	if sc["category"] != "Fair" {
		t.Fatalf("category = %v", sc["category"])
	}
	if sc["pm25"] != 3.6 {
		t.Fatalf("pm25 = %v", sc["pm25"])
	}
}

func TestAirQualityOmitsMissingPollutant(t *testing.T) {
	src := &stubSource{
		geocode: func(context.Context, string) (*GeoLocation, error) {
			return &GeoLocation{Name: "London", Latitude: 1, Longitude: 2}, nil
		},
		airQuality: func(context.Context, GeoLocation) (*AirQualityCurrent, error) {
			v := 10.0
			return &AirQualityCurrent{Time: "2026-01-01T00:00", EuropeanAQI: &v}, nil
		},
	}
	result := mustDemo(t, demoOptions{withinLimits: true, city: "London", tool: toolAirQuality, source: src})
	sc := structured(t, result)
	if sc["europeanAqi"] != float64(10) {
		t.Fatalf("europeanAqi = %v", sc["europeanAqi"])
	}
	if _, ok := sc["pm10"]; ok {
		t.Fatalf("pm10 should be absent: %#v", sc)
	}
	if _, ok := sc["pm25"]; ok {
		t.Fatalf("pm25 should be absent: %#v", sc)
	}
}

func TestAirQualityToolReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{withinLimits: false, city: "London", tool: toolAirQuality})
}

func TestCompareCitiesReturnsSideBySide(t *testing.T) {
	result := mustDemo(t, demoOptions{
		withinLimits: true,
		tool:         toolCompare,
		args:         map[string]any{"cities": []any{"London", "Paris"}},
	})
	sc := structured(t, result)
	cities, _ := sc["cities"].([]any)
	if len(cities) != 2 {
		t.Fatalf("cities len = %d", len(cities))
	}
	first, _ := cities[0].(map[string]any)
	if first["status"] != "ok" {
		t.Fatalf("first = %#v", first)
	}
}

func TestCompareCitiesRejectsCountOutOfRange(t *testing.T) {
	for _, cities := range [][]any{{"London"}, {"A", "B", "C", "D", "E", "F"}} {
		result := mustDemo(t, demoOptions{
			withinLimits: true,
			tool:         toolCompare,
			args:         map[string]any{"cities": cities},
		})
		if result["isError"] != true {
			t.Fatalf("cities=%v isError = %v", cities, result["isError"])
		}
	}
}

func TestCompareCitiesReportsUnresolvablePerRow(t *testing.T) {
	src := &stubSource{
		geocode: func(_ context.Context, city string) (*GeoLocation, error) {
			if city == "Narnia" {
				return nil, errNoResults
			}
			return decodeGeocode(mustReadFixture("geocode-london.json"))
		},
		forecast: func(context.Context, GeoLocation, int) (*ForecastData, error) {
			return decodeForecast(mustReadFixture("forecast-london.json"))
		},
	}
	result := mustDemo(t, demoOptions{
		withinLimits: true,
		tool:         toolCompare,
		source:       src,
		args:         map[string]any{"cities": []any{"London", "Narnia"}},
	})
	if result["isError"] == true {
		t.Fatalf("one unresolvable city must not fail the call: %#v", result)
	}
	sc := structured(t, result)
	cities, _ := sc["cities"].([]any)
	if len(cities) != 2 {
		t.Fatalf("cities len = %d", len(cities))
	}
	second, _ := cities[1].(map[string]any)
	if second["status"] == "ok" {
		t.Fatalf("Narnia should be reported per-row: %#v", second)
	}
	if second["city"] != "Narnia" {
		t.Fatalf("city = %v", second["city"])
	}
}

func TestCompareCitiesReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{
		withinLimits: false,
		tool:         toolCompare,
		args:         map[string]any{"cities": []any{"London", "Paris"}},
	})
}

func TestHistoricalWeatherReturnsArchiveDays(t *testing.T) {
	result := mustDemo(t, demoOptions{
		withinLimits: true,
		tool:         toolHistorical,
		args: map[string]any{
			"city":       "London",
			"start_date": "2024-01-01",
			"end_date":   "2024-01-03",
		},
	})
	sc := structured(t, result)
	days, _ := sc["days"].([]any)
	if len(days) != 3 {
		t.Fatalf("days len = %d", len(days))
	}
	first, _ := days[0].(map[string]any)
	if first["date"] != "2024-01-01" {
		t.Fatalf("date = %v", first["date"])
	}
	if first["maxC"] != 10.1 {
		t.Fatalf("maxC = %v", first["maxC"])
	}
}

func TestHistoricalWeatherRejectsBadDateRange(t *testing.T) {
	cases := []map[string]any{
		{"city": "London", "start_date": "01-01-2024", "end_date": "2024-01-03"},
		{"city": "London", "start_date": "2024-01-03", "end_date": "2024-01-01"},
	}
	for _, args := range cases {
		src := &stubSource{
			geocode: func(context.Context, string) (*GeoLocation, error) {
				t.Fatal("must reject date range before HTTP")
				return nil, nil
			},
		}
		result := mustDemo(t, demoOptions{withinLimits: true, tool: toolHistorical, source: src, args: args})
		if result["isError"] != true {
			t.Fatalf("args=%v isError = %v", args, result["isError"])
		}
	}
}

func TestHistoricalWeatherReturnsPaywallWhenOverLimit(t *testing.T) {
	assertPaywall(t, demoOptions{
		withinLimits: false,
		tool:         toolHistorical,
		args: map[string]any{
			"city":       "London",
			"start_date": "2024-01-01",
			"end_date":   "2024-01-03",
		},
	})
}

func mustDemo(t *testing.T, opts demoOptions) map[string]any {
	t.Helper()
	if opts.source == nil {
		opts.source = newFixtureSource()
	}
	result, err := runDemo(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func structured(t *testing.T, result map[string]any) map[string]any {
	t.Helper()
	if result["isError"] == true {
		t.Fatalf("unexpected error result: %#v", result)
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if sc == nil {
		t.Fatalf("missing structuredContent: %#v", result)
	}
	return sc
}

func assertPaywall(t *testing.T, opts demoOptions) {
	t.Helper()
	result := mustDemo(t, opts)
	if result["isError"] != false {
		t.Fatalf("isError = %v", result["isError"])
	}
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["kind"] != "payment_required" {
		t.Fatalf("kind = %v", sc["kind"])
	}
}

var errNoResults = errString("open-meteo geocode returned no results")

type errString string

func (e errString) Error() string { return string(e) }

type stubSource struct {
	geocode    func(context.Context, string) (*GeoLocation, error)
	forecast   func(context.Context, GeoLocation, int) (*ForecastData, error)
	airQuality func(context.Context, GeoLocation) (*AirQualityCurrent, error)
	archive    func(context.Context, GeoLocation, string, string) ([]ArchiveDay, error)
}

func (s *stubSource) Geocode(ctx context.Context, city string) (*GeoLocation, error) {
	if s.geocode == nil {
		return nil, errString("Geocode not implemented")
	}
	return s.geocode(ctx, city)
}

func (s *stubSource) Forecast(ctx context.Context, loc GeoLocation, days int) (*ForecastData, error) {
	if s.forecast == nil {
		return nil, errString("Forecast not implemented")
	}
	return s.forecast(ctx, loc, days)
}

func (s *stubSource) AirQuality(ctx context.Context, loc GeoLocation) (*AirQualityCurrent, error) {
	if s.airQuality == nil {
		return nil, errString("AirQuality not implemented")
	}
	return s.airQuality(ctx, loc)
}

func (s *stubSource) Archive(ctx context.Context, loc GeoLocation, start, end string) ([]ArchiveDay, error) {
	if s.archive == nil {
		return nil, errString("Archive not implemented")
	}
	return s.archive(ctx, loc, start, end)
}

func mustReadFixture(name string) []byte {
	raw, err := os.ReadFile(filepath.Join("fixtures", name))
	if err != nil {
		panic(err)
	}
	return raw
}
