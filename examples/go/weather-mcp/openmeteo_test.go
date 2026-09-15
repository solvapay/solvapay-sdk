package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWeatherCodeText(t *testing.T) {
	cases := []struct {
		code int
		want string
	}{
		{0, "Clear sky"},
		{1, "Mainly clear"},
		{2, "Partly cloudy"},
		{3, "Overcast"},
		{45, "Fog"},
		{48, "Depositing rime fog"},
		{51, "Light drizzle"},
		{53, "Moderate drizzle"},
		{55, "Dense drizzle"},
		{56, "Light freezing drizzle"},
		{57, "Dense freezing drizzle"},
		{61, "Slight rain"},
		{63, "Moderate rain"},
		{65, "Heavy rain"},
		{66, "Light freezing rain"},
		{67, "Heavy freezing rain"},
		{71, "Slight snow fall"},
		{73, "Moderate snow fall"},
		{75, "Heavy snow fall"},
		{77, "Snow grains"},
		{80, "Slight rain showers"},
		{81, "Moderate rain showers"},
		{82, "Violent rain showers"},
		{85, "Slight snow showers"},
		{86, "Heavy snow showers"},
		{95, "Thunderstorm"},
		{96, "Thunderstorm with slight hail"},
		{99, "Thunderstorm with heavy hail"},
		{1234, "Unknown weather code 1234"},
	}
	for _, tc := range cases {
		if got := weatherCodeText(tc.code); got != tc.want {
			t.Errorf("weatherCodeText(%d) = %q, want %q", tc.code, got, tc.want)
		}
	}
}

func TestDecodeGeocodeLondon(t *testing.T) {
	loc, err := decodeGeocode(readFixture(t, "geocode-london.json"))
	if err != nil {
		t.Fatal(err)
	}
	if loc.Name != "London" {
		t.Fatalf("Name = %q", loc.Name)
	}
	if loc.Country != "United Kingdom" {
		t.Fatalf("Country = %q", loc.Country)
	}
	if loc.Admin1 != "England" {
		t.Fatalf("Admin1 = %q", loc.Admin1)
	}
	if loc.Latitude != 51.50853 {
		t.Fatalf("Latitude = %v", loc.Latitude)
	}
	if loc.Longitude != -0.12574 {
		t.Fatalf("Longitude = %v", loc.Longitude)
	}
	if loc.Timezone != "Europe/London" {
		t.Fatalf("Timezone = %q", loc.Timezone)
	}
}

func TestDecodeGeocodeEmptyResults(t *testing.T) {
	_, err := decodeGeocode([]byte(`{"results":[]}`))
	if err == nil {
		t.Fatal("expected error for empty geocode results")
	}
}

func TestDecodeForecastLondon(t *testing.T) {
	data, err := decodeForecast(readFixture(t, "forecast-london.json"))
	if err != nil {
		t.Fatal(err)
	}
	c := data.Current
	if c.Temperature != 21.1 {
		t.Fatalf("Temperature = %v", c.Temperature)
	}
	if c.ApparentTemperature != 20.1 {
		t.Fatalf("ApparentTemperature = %v", c.ApparentTemperature)
	}
	if c.Humidity != 58 {
		t.Fatalf("Humidity = %v", c.Humidity)
	}
	if c.WindSpeed != 12.2 {
		t.Fatalf("WindSpeed = %v", c.WindSpeed)
	}
	if c.WindDirection != 305 {
		t.Fatalf("WindDirection = %v", c.WindDirection)
	}
	if c.WindGusts != 26.3 {
		t.Fatalf("WindGusts = %v", c.WindGusts)
	}
	if c.Precipitation != 0 {
		t.Fatalf("Precipitation = %v", c.Precipitation)
	}
	if c.CloudCover != 86 {
		t.Fatalf("CloudCover = %v", c.CloudCover)
	}
	if !c.IsDay {
		t.Fatal("IsDay = false")
	}
	if c.WeatherCode != 3 {
		t.Fatalf("WeatherCode = %d", c.WeatherCode)
	}
	if c.Condition != weatherCodeText(3) || c.Condition == "" {
		t.Fatalf("Condition = %q", c.Condition)
	}
	if c.Time != "2026-08-31T17:45" {
		t.Fatalf("Time = %q", c.Time)
	}
	if len(data.Daily) != 3 {
		t.Fatalf("Daily len = %d", len(data.Daily))
	}
	day := data.Daily[0]
	if day.Date != "2026-08-31" {
		t.Fatalf("Date = %q", day.Date)
	}
	if day.MaxC != 22.0 {
		t.Fatalf("MaxC = %v", day.MaxC)
	}
	if day.MinC != 14.9 {
		t.Fatalf("MinC = %v", day.MinC)
	}
	if day.ApparentMaxC != 20.2 {
		t.Fatalf("ApparentMaxC = %v", day.ApparentMaxC)
	}
	if day.ApparentMinC != 12.9 {
		t.Fatalf("ApparentMinC = %v", day.ApparentMinC)
	}
	if day.PrecipitationSum != 0.8 {
		t.Fatalf("PrecipitationSum = %v", day.PrecipitationSum)
	}
	if day.PrecipitationProbability != 78 {
		t.Fatalf("PrecipitationProbability = %d", day.PrecipitationProbability)
	}
	if day.Sunrise != "2026-08-31T06:11" {
		t.Fatalf("Sunrise = %q", day.Sunrise)
	}
	if day.Sunset != "2026-08-31T19:49" {
		t.Fatalf("Sunset = %q", day.Sunset)
	}
	if day.UVIndexMax != 3.5 {
		t.Fatalf("UVIndexMax = %v", day.UVIndexMax)
	}
	if day.WindSpeedMax != 18.4 {
		t.Fatalf("WindSpeedMax = %v", day.WindSpeedMax)
	}
	if day.WeatherCode != 53 {
		t.Fatalf("WeatherCode = %d", day.WeatherCode)
	}
	if day.Condition != weatherCodeText(53) {
		t.Fatalf("Condition = %q", day.Condition)
	}
	if len(data.Hourly) < 12 {
		t.Fatalf("Hourly len = %d, want at least 12", len(data.Hourly))
	}
	hour := data.Hourly[0]
	if hour.Time != "2026-08-31T00:00" {
		t.Fatalf("Hourly Time = %q", hour.Time)
	}
	if hour.Temperature != 16.9 {
		t.Fatalf("Hourly Temperature = %v", hour.Temperature)
	}
	if hour.PrecipitationProbability != 73 {
		t.Fatalf("Hourly PrecipitationProbability = %d", hour.PrecipitationProbability)
	}
	if hour.WindSpeed != 15.8 {
		t.Fatalf("Hourly WindSpeed = %v", hour.WindSpeed)
	}
	if hour.WeatherCode != 1 {
		t.Fatalf("Hourly WeatherCode = %d", hour.WeatherCode)
	}
}

func TestDecodeAirQualityLondon(t *testing.T) {
	aq, err := decodeAirQuality(readFixture(t, "air-quality-london.json"))
	if err != nil {
		t.Fatal(err)
	}
	if aq.Time != "2026-08-31T17:00" {
		t.Fatalf("Time = %q", aq.Time)
	}
	assertFloatPtr(t, "EuropeanAQI", aq.EuropeanAQI, 31)
	assertFloatPtr(t, "USAQI", aq.USAQI, 26)
	assertFloatPtr(t, "PM10", aq.PM10, 5.1)
	assertFloatPtr(t, "PM25", aq.PM25, 3.6)
	assertFloatPtr(t, "Ozone", aq.Ozone, 78)
	assertFloatPtr(t, "NitrogenDioxide", aq.NitrogenDioxide, 7.3)
}

func TestDecodeAirQualityOmitsMissingPollutant(t *testing.T) {
	aq, err := decodeAirQuality([]byte(`{"current":{"time":"2026-01-01T00:00","european_aqi":10}}`))
	if err != nil {
		t.Fatal(err)
	}
	if aq.EuropeanAQI == nil || *aq.EuropeanAQI != 10 {
		t.Fatalf("EuropeanAQI = %v", aq.EuropeanAQI)
	}
	if aq.PM10 != nil || aq.PM25 != nil || aq.Ozone != nil || aq.USAQI != nil || aq.NitrogenDioxide != nil {
		t.Fatal("missing pollutants must stay absent")
	}
}

func TestDecodeArchiveLondon(t *testing.T) {
	days, err := decodeArchive(readFixture(t, "archive-london.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 3 {
		t.Fatalf("len = %d", len(days))
	}
	day := days[0]
	if day.Date != "2024-01-01" {
		t.Fatalf("Date = %q", day.Date)
	}
	if day.MaxC != 10.1 {
		t.Fatalf("MaxC = %v", day.MaxC)
	}
	if day.MinC != 5.9 {
		t.Fatalf("MinC = %v", day.MinC)
	}
	if day.ApparentMaxC != 6.3 {
		t.Fatalf("ApparentMaxC = %v", day.ApparentMaxC)
	}
	if day.ApparentMinC != 1.0 {
		t.Fatalf("ApparentMinC = %v", day.ApparentMinC)
	}
	if day.PrecipitationSum != 8.3 {
		t.Fatalf("PrecipitationSum = %v", day.PrecipitationSum)
	}
	if day.WindSpeedMax != 30.6 {
		t.Fatalf("WindSpeedMax = %v", day.WindSpeedMax)
	}
	if day.WeatherCode != 61 {
		t.Fatalf("WeatherCode = %d", day.WeatherCode)
	}
	if day.Condition != weatherCodeText(61) {
		t.Fatalf("Condition = %q", day.Condition)
	}
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertFloatPtr(t *testing.T, name string, got *float64, want float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s is nil", name)
	}
	if *got != want {
		t.Fatalf("%s = %v, want %v", name, *got, want)
	}
}
