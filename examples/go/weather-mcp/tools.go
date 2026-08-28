package main

import (
	"context"
	"fmt"
	"strings"

	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

const (
	toolCurrentWeather = "get_current_weather"
	toolForecast       = "get_weather_forecast"
)

type payableRegistry interface {
	RegisterPayable(name string, opts solvapaymcp.Options) error
}

var _ payableRegistry = (*solvapaymcp.Server)(nil)

func registerTools(reg payableRegistry, source Source, product string, getCustomerRef solvapaymcp.GetCustomerRef) error {
	citySchema := map[string]any{"city": map[string]any{"type": "string"}}
	if err := reg.RegisterPayable(toolCurrentWeather, solvapaymcp.Options{
		Product:        product,
		Title:          "Get current weather",
		Description:    "Current conditions for a city from wttr.in.",
		InputSchema:    citySchema,
		GetCustomerRef: getCustomerRef,
		Handler:        currentWeatherHandler(source),
	}); err != nil {
		return err
	}
	return reg.RegisterPayable(toolForecast, solvapaymcp.Options{
		Product:        product,
		Title:          "Get weather forecast",
		Description:    "Three-day forecast for a city from wttr.in.",
		InputSchema:    citySchema,
		GetCustomerRef: getCustomerRef,
		Handler:        forecastHandler(source),
	})
}

func currentWeatherHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		report, err := fetchReport(ctx, source, args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		return rc.Respond(map[string]any{
			"location":     locationPayload(report),
			"temperatureC": report.Current.TempC,
			"feelsLikeC":   report.Current.FeelsLikeC,
			"humidity":     report.Current.Humidity,
			"windKmph":     report.Current.WindKmph,
			"condition":    report.Current.Condition,
		}, nil)
	}
}

func forecastHandler(source Source) solvapaymcp.Handler {
	return func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
		report, err := fetchReport(ctx, source, args)
		if err != nil {
			return solvapaymcp.Response{}, err
		}
		days := make([]map[string]any, 0, len(report.Forecast))
		for _, day := range report.Forecast {
			days = append(days, map[string]any{
				"date":      day.Date,
				"minC":      day.MinC,
				"maxC":      day.MaxC,
				"avgC":      day.AvgC,
				"sunrise":   day.Sunrise,
				"sunset":    day.Sunset,
				"condition": day.Condition,
			})
		}
		return rc.Respond(map[string]any{
			"location": locationPayload(report),
			"days":     days,
		}, nil)
	}
}

func fetchReport(ctx context.Context, source Source, args map[string]any) (*Report, error) {
	city := cityArg(args)
	if city == "" {
		return nil, fmt.Errorf("city is required")
	}
	return source.Fetch(ctx, city)
}

func cityArg(args map[string]any) string {
	city, _ := args["city"].(string)
	return strings.TrimSpace(city)
}

func locationPayload(report *Report) map[string]any {
	return map[string]any{
		"name":    report.Location.Name,
		"country": report.Location.Country,
		"region":  report.Location.Region,
	}
}
