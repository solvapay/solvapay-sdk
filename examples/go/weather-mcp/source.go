package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultGeocodeBase    = "https://geocoding-api.open-meteo.com"
	defaultForecastBase   = "https://api.open-meteo.com"
	defaultAirQualityBase = "https://air-quality-api.open-meteo.com"
	defaultArchiveBase    = "https://archive-api.open-meteo.com"
	weatherUserAgent      = "solvapay-weather-mcp/0.1 (+https://github.com/solvapay/solvapay-sdk)"

	forecastCurrentFields = "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
	forecastHourlyFields  = "temperature_2m,precipitation_probability,weather_code,wind_speed_10m"
	forecastDailyFields   = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max"
	airQualityFields      = "european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide"
	archiveDailyFields    = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,wind_speed_10m_max"
)

type Source interface {
	Geocode(ctx context.Context, city string) (*GeoLocation, error)
	Forecast(ctx context.Context, loc GeoLocation, days int) (*ForecastData, error)
	AirQuality(ctx context.Context, loc GeoLocation) (*AirQualityCurrent, error)
	Archive(ctx context.Context, loc GeoLocation, startDate, endDate string) ([]ArchiveDay, error)
}

var (
	_ Source = (*liveSource)(nil)
	_ Source = (*fixtureSource)(nil)
)

type liveSource struct {
	geocodeBase    string
	forecastBase   string
	airQualityBase string
	archiveBase    string
	client         *http.Client
}

func newLiveSource(baseURL string) *liveSource {
	s := &liveSource{
		geocodeBase:    defaultGeocodeBase,
		forecastBase:   defaultForecastBase,
		airQualityBase: defaultAirQualityBase,
		archiveBase:    defaultArchiveBase,
		client:         &http.Client{Timeout: 10 * time.Second},
	}
	if baseURL != "" {
		override := strings.TrimRight(baseURL, "/")
		s.geocodeBase = override
		s.forecastBase = override
		s.airQualityBase = override
		s.archiveBase = override
	}
	return s
}

func (s *liveSource) Geocode(ctx context.Context, city string) (*GeoLocation, error) {
	query := url.Values{
		"name":     {city},
		"count":    {"1"},
		"language": {"en"},
		"format":   {"json"},
	}
	raw, err := s.getJSON(ctx, s.geocodeBase, "/v1/search", query, "geocode")
	if err != nil {
		return nil, err
	}
	return decodeGeocode(raw)
}

func (s *liveSource) Forecast(ctx context.Context, loc GeoLocation, days int) (*ForecastData, error) {
	query := latLonQuery(loc)
	query.Set("current", forecastCurrentFields)
	query.Set("hourly", forecastHourlyFields)
	query.Set("daily", forecastDailyFields)
	query.Set("timezone", "auto")
	query.Set("forecast_days", strconv.Itoa(days))
	raw, err := s.getJSON(ctx, s.forecastBase, "/v1/forecast", query, "forecast")
	if err != nil {
		return nil, err
	}
	return decodeForecast(raw)
}

func (s *liveSource) AirQuality(ctx context.Context, loc GeoLocation) (*AirQualityCurrent, error) {
	query := latLonQuery(loc)
	query.Set("current", airQualityFields)
	query.Set("timezone", "auto")
	raw, err := s.getJSON(ctx, s.airQualityBase, "/v1/air-quality", query, "air quality")
	if err != nil {
		return nil, err
	}
	return decodeAirQuality(raw)
}

func (s *liveSource) Archive(ctx context.Context, loc GeoLocation, startDate, endDate string) ([]ArchiveDay, error) {
	query := latLonQuery(loc)
	query.Set("start_date", startDate)
	query.Set("end_date", endDate)
	query.Set("daily", archiveDailyFields)
	query.Set("timezone", "auto")
	raw, err := s.getJSON(ctx, s.archiveBase, "/v1/archive", query, "archive")
	if err != nil {
		return nil, err
	}
	return decodeArchive(raw)
}

func (s *liveSource) getJSON(ctx context.Context, baseURL, path string, query url.Values, label string) ([]byte, error) {
	base, err := url.Parse(strings.TrimRight(baseURL, "/") + "/")
	if err != nil {
		return nil, fmt.Errorf("open-meteo %s base URL: %w", label, err)
	}
	rel := &url.URL{Path: strings.TrimPrefix(path, "/"), RawQuery: query.Encode()}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.ResolveReference(rel).String(), nil)
	if err != nil {
		return nil, fmt.Errorf("open-meteo %s request: %w", label, err)
	}
	req.Header.Set("User-Agent", weatherUserAgent)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("open-meteo %s fetch: %w", label, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("open-meteo %s read: %w", label, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open-meteo %s returned HTTP %d", label, resp.StatusCode)
	}
	return body, nil
}

func latLonQuery(loc GeoLocation) url.Values {
	return url.Values{
		"latitude":  {strconv.FormatFloat(loc.Latitude, 'f', -1, 64)},
		"longitude": {strconv.FormatFloat(loc.Longitude, 'f', -1, 64)},
	}
}

type fixtureSource struct {
	dir string
}

func newFixtureSource() *fixtureSource {
	return &fixtureSource{dir: "fixtures"}
}

func (s *fixtureSource) Geocode(_ context.Context, _ string) (*GeoLocation, error) {
	raw, err := s.read("geocode-london.json")
	if err != nil {
		return nil, err
	}
	return decodeGeocode(raw)
}

func (s *fixtureSource) Forecast(_ context.Context, _ GeoLocation, _ int) (*ForecastData, error) {
	raw, err := s.read("forecast-london.json")
	if err != nil {
		return nil, err
	}
	return decodeForecast(raw)
}

func (s *fixtureSource) AirQuality(_ context.Context, _ GeoLocation) (*AirQualityCurrent, error) {
	raw, err := s.read("air-quality-london.json")
	if err != nil {
		return nil, err
	}
	return decodeAirQuality(raw)
}

func (s *fixtureSource) Archive(_ context.Context, _ GeoLocation, _, _ string) ([]ArchiveDay, error) {
	raw, err := s.read("archive-london.json")
	if err != nil {
		return nil, err
	}
	return decodeArchive(raw)
}

func (s *fixtureSource) read(name string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(s.dir, name))
	if err != nil {
		return nil, fmt.Errorf("read weather fixture %s: %w", name, err)
	}
	return raw, nil
}
