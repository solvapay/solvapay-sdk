package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestLiveSourceGeocodeQuery(t *testing.T) {
	var gotPath string
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		got = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(readFixture(t, "geocode-london.json"))
	}))
	t.Cleanup(srv.Close)

	loc, err := newLiveSource(srv.URL).Geocode(context.Background(), "London")
	if err != nil {
		t.Fatal(err)
	}
	if loc.Name != "London" {
		t.Fatalf("Name = %q", loc.Name)
	}
	if gotPath != "/v1/search" {
		t.Fatalf("path = %q", gotPath)
	}
	if got.Get("name") != "London" || got.Get("count") != "1" || got.Get("language") != "en" || got.Get("format") != "json" {
		t.Fatalf("query = %s", got.Encode())
	}
}

func TestLiveSourceForecastQuery(t *testing.T) {
	var gotPath string
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		got = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(readFixture(t, "forecast-london.json"))
	}))
	t.Cleanup(srv.Close)

	loc := GeoLocation{Name: "London", Latitude: 51.50853, Longitude: -0.12574}
	data, err := newLiveSource(srv.URL).Forecast(context.Background(), loc, 3)
	if err != nil {
		t.Fatal(err)
	}
	if data.Current.Temperature != 21.1 {
		t.Fatalf("Temperature = %v", data.Current.Temperature)
	}
	if gotPath != "/v1/forecast" {
		t.Fatalf("path = %q", gotPath)
	}
	if got.Get("latitude") != "51.50853" || got.Get("longitude") != "-0.12574" {
		t.Fatalf("lat/lon query = %s", got.Encode())
	}
	if got.Get("timezone") != "auto" {
		t.Fatalf("timezone = %q", got.Get("timezone"))
	}
	if got.Get("current") == "" || got.Get("daily") == "" || got.Get("hourly") == "" {
		t.Fatalf("missing current/daily/hourly: %s", got.Encode())
	}
	if got.Get("forecast_days") != "3" {
		t.Fatalf("forecast_days = %q", got.Get("forecast_days"))
	}
}

func TestLiveSourceAirQualityQuery(t *testing.T) {
	var gotPath string
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		got = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(readFixture(t, "air-quality-london.json"))
	}))
	t.Cleanup(srv.Close)

	loc := GeoLocation{Latitude: 51.50853, Longitude: -0.12574}
	aq, err := newLiveSource(srv.URL).AirQuality(context.Background(), loc)
	if err != nil {
		t.Fatal(err)
	}
	if aq.EuropeanAQI == nil {
		t.Fatal("EuropeanAQI missing")
	}
	if gotPath != "/v1/air-quality" {
		t.Fatalf("path = %q", gotPath)
	}
	if got.Get("latitude") != "51.50853" || got.Get("longitude") != "-0.12574" {
		t.Fatalf("lat/lon query = %s", got.Encode())
	}
	if got.Get("timezone") != "auto" {
		t.Fatalf("timezone = %q", got.Get("timezone"))
	}
	if !strings.Contains(got.Get("current"), "european_aqi") || !strings.Contains(got.Get("current"), "pm2_5") {
		t.Fatalf("current = %q", got.Get("current"))
	}
}

func TestLiveSourceArchiveQuery(t *testing.T) {
	var gotPath string
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		got = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(readFixture(t, "archive-london.json"))
	}))
	t.Cleanup(srv.Close)

	loc := GeoLocation{Latitude: 51.50853, Longitude: -0.12574}
	days, err := newLiveSource(srv.URL).Archive(context.Background(), loc, "2024-01-01", "2024-01-03")
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 3 {
		t.Fatalf("len = %d", len(days))
	}
	if gotPath != "/v1/archive" {
		t.Fatalf("path = %q", gotPath)
	}
	if got.Get("latitude") != "51.50853" || got.Get("longitude") != "-0.12574" {
		t.Fatalf("lat/lon query = %s", got.Encode())
	}
	if got.Get("start_date") != "2024-01-01" || got.Get("end_date") != "2024-01-03" {
		t.Fatalf("dates = %s", got.Encode())
	}
	if got.Get("timezone") != "auto" || got.Get("daily") == "" {
		t.Fatalf("query = %s", got.Encode())
	}
}

func TestLiveSourceOpenMeteoErrorsOnNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	}))
	t.Cleanup(srv.Close)

	src := newLiveSource(srv.URL)
	loc := GeoLocation{Latitude: 51.5, Longitude: -0.1}
	cases := []struct {
		name string
		call func() error
	}{
		{"geocode", func() error { _, err := src.Geocode(context.Background(), "London"); return err }},
		{"forecast", func() error { _, err := src.Forecast(context.Background(), loc, 3); return err }},
		{"air quality", func() error { _, err := src.AirQuality(context.Background(), loc); return err }},
		{"archive", func() error { _, err := src.Archive(context.Background(), loc, "2024-01-01", "2024-01-02"); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "502") {
				t.Fatalf("error %q does not name status 502", err)
			}
		})
	}
}

func TestLiveSourceGeocodeEmptyResultsIsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	t.Cleanup(srv.Close)

	_, err := newLiveSource(srv.URL).Geocode(context.Background(), "Narnia")
	if err == nil {
		t.Fatal("empty geocode results must be an error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "no results") {
		t.Fatalf("error %q should say no results", err)
	}
}
