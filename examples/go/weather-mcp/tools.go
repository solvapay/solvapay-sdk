package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	solvapaymcp "github.com/solvapay/solvapay-sdk/sdks/go/mcp"
)

const (
	toolCurrentWeather = "get_current_weather"
	toolForecast       = "get_weather_forecast"
	toolHourly         = "get_hourly_forecast"
	toolAirQuality     = "get_air_quality"
	toolCompare        = "compare_cities"
	toolHistorical     = "get_historical_weather"
)

type payableRegistry interface {
	RegisterPayable(name string, opts solvapaymcp.Options) error
}

var _ payableRegistry = (*solvapaymcp.Server)(nil)

func registerTools(reg payableRegistry, source Source, product string, getCustomerRef solvapaymcp.GetCustomerRef) error {
	tools := []struct {
		name string
		opts solvapaymcp.Options
	}{
		{
			name: toolCurrentWeather,
			opts: solvapaymcp.Options{
				Title:       "Get current weather",
				Description: "Current conditions for a city from Open-Meteo.",
				InputSchema: map[string]any{"city": map[string]any{"type": "string"}},
				Handler:     currentWeatherHandler(source),
			},
		},
		{
			name: toolForecast,
			opts: solvapaymcp.Options{
				Title:       "Get weather forecast",
				Description: "Daily forecast for a city from Open-Meteo (1–16 days, default 3).",
				InputSchema: map[string]any{"city": map[string]any{"type": "string"}},
				Handler:     forecastHandler(source),
			},
		},
		{
			name: toolHourly,
			opts: solvapaymcp.Options{
				Title:       "Get hourly forecast",
				Description: "Hourly forecast for a city from Open-Meteo (1–48 hours, default 12).",
				InputSchema: map[string]any{"city": map[string]any{"type": "string"}},
				Handler:     hourlyHandler(source),
			},
		},
		{
			name: toolAirQuality,
			opts: solvapaymcp.Options{
				Title:       "Get air quality",
				Description: "Current air quality for a city from Open-Meteo.",
				InputSchema: map[string]any{"city": map[string]any{"type": "string"}},
				Handler:     airQualityHandler(source),
			},
		},
		{
			name: toolCompare,
			opts: solvapaymcp.Options{
				Title:       "Compare cities",
				Description: "Current conditions for 2–5 cities side by side.",
				InputSchema: map[string]any{},
				Handler:     compareHandler(source),
			},
		},
		{
			name: toolHistorical,
			opts: solvapaymcp.Options{
				Title:       "Get historical weather",
				Description: "Daily archive weather for a city between two ISO dates.",
				InputSchema: map[string]any{
					"city":       map[string]any{"type": "string"},
					"start_date": map[string]any{"type": "string"},
					"end_date":   map[string]any{"type": "string"},
				},
				Handler: historicalHandler(source),
			},
		},
	}
	for _, tool := range tools {
		tool.opts.Product = product
		tool.opts.GetCustomerRef = getCustomerRef
		if err := reg.RegisterPayable(tool.name, tool.opts); err != nil {
			return err
		}
	}
	return nil
}

func currentWeatherHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		loc, data, err := geocodeForecast(ctx, source, args, 1)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		cur := data.Current
		return rc.Respond(map[string]any{
			"location":             locationPayload(loc),
			"time":                 cur.Time,
			"temperatureC":         cur.Temperature,
			"apparentTemperatureC": cur.ApparentTemperature,
			"humidity":             cur.Humidity,
			"windSpeed":            cur.WindSpeed,
			"windDirection":        cur.WindDirection,
			"windGusts":            cur.WindGusts,
			"precipitation":        cur.Precipitation,
			"cloudCover":           cur.CloudCover,
			"isDay":                cur.IsDay,
			"condition":            cur.Condition,
			"weatherCode":          cur.WeatherCode,
		}, nil)
	}
}

func forecastHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		days, err := boundedIntArg(args, "days", 3, 1, 16)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		loc, data, err := geocodeForecast(ctx, source, args, days)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		if len(data.Daily) > days {
			data.Daily = data.Daily[:days]
		}
		out := make([]map[string]any, 0, len(data.Daily))
		for _, day := range data.Daily {
			out = append(out, map[string]any{
				"date":                     day.Date,
				"minC":                     day.MinC,
				"maxC":                     day.MaxC,
				"apparentMinC":             day.ApparentMinC,
				"apparentMaxC":             day.ApparentMaxC,
				"precipitationSum":         day.PrecipitationSum,
				"precipitationProbability": day.PrecipitationProbability,
				"sunrise":                  day.Sunrise,
				"sunset":                   day.Sunset,
				"uvIndexMax":               day.UVIndexMax,
				"windSpeedMax":             day.WindSpeedMax,
				"condition":                day.Condition,
			})
		}
		return rc.Respond(map[string]any{
			"location": locationPayload(loc),
			"days":     out,
		}, nil)
	}
}

func hourlyHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		hours, err := boundedIntArg(args, "hours", 12, 1, 48)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		loc, data, err := geocodeForecast(ctx, source, args, 3)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		points := data.Hourly
		if len(points) > hours {
			points = points[:hours]
		}
		out := make([]map[string]any, 0, len(points))
		for _, hour := range points {
			out = append(out, map[string]any{
				"time":                     hour.Time,
				"temperatureC":             hour.Temperature,
				"precipitationProbability": hour.PrecipitationProbability,
				"windSpeed":                hour.WindSpeed,
				"condition":                hour.Condition,
			})
		}
		return rc.Respond(map[string]any{
			"location": locationPayload(loc),
			"hours":    out,
		}, nil)
	}
}

func airQualityHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		loc, err := geocodeCity(ctx, source, args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		aq, err := source.AirQuality(ctx, *loc)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		payload := map[string]any{
			"location": locationPayload(loc),
			"time":     aq.Time,
			"category": aqiCategory(aq.EuropeanAQI),
		}
		setOptionalFloat(payload, "europeanAqi", aq.EuropeanAQI)
		setOptionalFloat(payload, "usAqi", aq.USAQI)
		setOptionalFloat(payload, "pm10", aq.PM10)
		setOptionalFloat(payload, "pm25", aq.PM25)
		setOptionalFloat(payload, "ozone", aq.Ozone)
		setOptionalFloat(payload, "nitrogenDioxide", aq.NitrogenDioxide)
		return rc.Respond(payload, nil)
	}
}

func compareHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		cities, err := citiesArg(args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		rows := make([]map[string]any, 0, len(cities))
		for _, city := range cities {
			row := map[string]any{"city": city}
			loc, err := source.Geocode(ctx, city)
			if err != nil {
				row["status"] = "error"
				row["error"] = err.Error()
				rows = append(rows, row)
				continue
			}
			data, err := source.Forecast(ctx, *loc, 1)
			if err != nil {
				row["status"] = "error"
				row["error"] = err.Error()
				rows = append(rows, row)
				continue
			}
			row["status"] = "ok"
			row["location"] = locationPayload(loc)
			row["temperatureC"] = data.Current.Temperature
			row["condition"] = data.Current.Condition
			row["humidity"] = data.Current.Humidity
			row["windSpeed"] = data.Current.WindSpeed
			rows = append(rows, row)
		}
		return rc.Respond(map[string]any{"cities": rows}, nil)
	}
}

func historicalHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		start, end, err := dateRangeArgs(args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		loc, err := geocodeCity(ctx, source, args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		days, err := source.Archive(ctx, *loc, start, end)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		out := make([]map[string]any, 0, len(days))
		for _, day := range days {
			out = append(out, map[string]any{
				"date":             day.Date,
				"minC":             day.MinC,
				"maxC":             day.MaxC,
				"apparentMinC":     day.ApparentMinC,
				"apparentMaxC":     day.ApparentMaxC,
				"precipitationSum": day.PrecipitationSum,
				"windSpeedMax":     day.WindSpeedMax,
				"condition":        day.Condition,
			})
		}
		return rc.Respond(map[string]any{
			"location": locationPayload(loc),
			"days":     out,
		}, nil)
	}
}

func geocodeForecast(ctx context.Context, source Source, args map[string]any, days int) (*GeoLocation, *ForecastData, error) {
	loc, err := geocodeCity(ctx, source, args)
	if err != nil {
		return nil, nil, err
	}
	data, err := source.Forecast(ctx, *loc, days)
	if err != nil {
		return nil, nil, err
	}
	return loc, data, nil
}

func geocodeCity(ctx context.Context, source Source, args map[string]any) (*GeoLocation, error) {
	city := cityArg(args)
	if city == "" {
		return nil, fmt.Errorf("city is required")
	}
	return source.Geocode(ctx, city)
}

func cityArg(args map[string]any) string {
	city, _ := args["city"].(string)
	return strings.TrimSpace(city)
}

func citiesArg(args map[string]any) ([]string, error) {
	raw, ok := args["cities"]
	if !ok {
		return nil, fmt.Errorf("cities is required")
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("cities must be an array of strings")
	}
	if len(items) < 2 || len(items) > 5 {
		return nil, fmt.Errorf("cities must contain between 2 and 5 names")
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		city, _ := item.(string)
		city = strings.TrimSpace(city)
		if city == "" {
			return nil, fmt.Errorf("cities must contain non-empty names")
		}
		out = append(out, city)
	}
	return out, nil
}

func boundedIntArg(args map[string]any, name string, defaultVal, min, max int) (int, error) {
	raw, ok := args[name]
	if !ok || raw == nil {
		return defaultVal, nil
	}
	n, err := asInt(raw, name)
	if err != nil {
		return 0, err
	}
	if n < min || n > max {
		return 0, fmt.Errorf("%s must be between %d and %d", name, min, max)
	}
	return n, nil
}

func asInt(raw any, name string) (int, error) {
	switch v := raw.(type) {
	case int:
		return v, nil
	case float64:
		if v != float64(int(v)) {
			return 0, fmt.Errorf("%s must be an integer", name)
		}
		return int(v), nil
	default:
		return 0, fmt.Errorf("%s must be an integer", name)
	}
}

func dateRangeArgs(args map[string]any) (string, string, error) {
	start, err := isoDateArg(args, "start_date")
	if err != nil {
		return "", "", err
	}
	end, err := isoDateArg(args, "end_date")
	if err != nil {
		return "", "", err
	}
	if start.After(end) {
		return "", "", fmt.Errorf("start_date must be on or before end_date")
	}
	return start.Format(time.DateOnly), end.Format(time.DateOnly), nil
}

func isoDateArg(args map[string]any, name string) (time.Time, error) {
	raw, _ := args[name].(string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, fmt.Errorf("%s is required", name)
	}
	parsed, err := time.Parse(time.DateOnly, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be an ISO date (yyyy-mm-dd)", name)
	}
	return parsed, nil
}

func locationPayload(loc *GeoLocation) map[string]any {
	return map[string]any{
		"name":      loc.Name,
		"country":   loc.Country,
		"admin1":    loc.Admin1,
		"latitude":  loc.Latitude,
		"longitude": loc.Longitude,
		"timezone":  loc.Timezone,
	}
}

func setOptionalFloat(payload map[string]any, key string, value *float64) {
	if value == nil {
		return
	}
	payload[key] = *value
}

func aqiCategory(european *float64) string {
	if european == nil {
		return "Unknown"
	}
	v := *european
	switch {
	case v <= 20:
		return "Good"
	case v <= 40:
		return "Fair"
	case v <= 60:
		return "Moderate"
	case v <= 80:
		return "Poor"
	case v <= 100:
		return "Very poor"
	default:
		return "Extremely poor"
	}
}
