package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type Report struct {
	Current  CurrentWeather
	Location Location
	Forecast []ForecastDay
}

type CurrentWeather struct {
	TempC      int
	FeelsLikeC int
	Humidity   int
	WindKmph   int
	Condition  string
}

type Location struct {
	Name    string
	Country string
	Region  string
}

type ForecastDay struct {
	Date      string
	MinC      int
	MaxC      int
	AvgC      int
	Sunrise   string
	Sunset    string
	Condition string
}

type j1Payload struct {
	CurrentCondition []j1Current `json:"current_condition"`
	NearestArea      []j1Area    `json:"nearest_area"`
	Weather          []j1Day     `json:"weather"`
}

type j1Current struct {
	TempC         string       `json:"temp_C"`
	FeelsLikeC    string       `json:"FeelsLikeC"`
	Humidity      string       `json:"humidity"`
	WindspeedKmph string       `json:"windspeedKmph"`
	WeatherDesc   []j1NamedVal `json:"weatherDesc"`
}

type j1Area struct {
	AreaName []j1NamedVal `json:"areaName"`
	Country  []j1NamedVal `json:"country"`
	Region   []j1NamedVal `json:"region"`
}

type j1Day struct {
	Date      string        `json:"date"`
	MinTempC  string        `json:"mintempC"`
	MaxTempC  string        `json:"maxtempC"`
	AvgTempC  string        `json:"avgtempC"`
	Astronomy []j1Astronomy `json:"astronomy"`
	Hourly    []j1Hourly    `json:"hourly"`
}

type j1Astronomy struct {
	Sunrise string `json:"sunrise"`
	Sunset  string `json:"sunset"`
}

type j1Hourly struct {
	WeatherDesc []j1NamedVal `json:"weatherDesc"`
}

type j1NamedVal struct {
	Value string `json:"value"`
}

func decodeReport(raw []byte) (*Report, error) {
	var payload j1Payload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode wttr.in j1: %w", err)
	}
	current, err := first(payload.CurrentCondition, "current_condition")
	if err != nil {
		return nil, err
	}
	desc, err := first(current.WeatherDesc, "current_condition.weatherDesc")
	if err != nil {
		return nil, err
	}
	tempC, err := parseIntField("temp_C", current.TempC)
	if err != nil {
		return nil, err
	}
	feels, err := parseIntField("FeelsLikeC", current.FeelsLikeC)
	if err != nil {
		return nil, err
	}
	humidity, err := parseIntField("humidity", current.Humidity)
	if err != nil {
		return nil, err
	}
	wind, err := parseIntField("windspeedKmph", current.WindspeedKmph)
	if err != nil {
		return nil, err
	}

	report := &Report{
		Current: CurrentWeather{
			TempC:      tempC,
			FeelsLikeC: feels,
			Humidity:   humidity,
			WindKmph:   wind,
			Condition:  strings.TrimSpace(desc.Value),
		},
	}

	if area, err := first(payload.NearestArea, "nearest_area"); err == nil {
		report.Location = Location{
			Name:    namedValue(area.AreaName),
			Country: namedValue(area.Country),
			Region:  namedValue(area.Region),
		}
	}

	for i, day := range payload.Weather {
		minC, err := parseIntField("mintempC", day.MinTempC)
		if err != nil {
			return nil, fmt.Errorf("weather[%d]: %w", i, err)
		}
		maxC, err := parseIntField("maxtempC", day.MaxTempC)
		if err != nil {
			return nil, fmt.Errorf("weather[%d]: %w", i, err)
		}
		avgC, err := parseIntField("avgtempC", day.AvgTempC)
		if err != nil {
			return nil, fmt.Errorf("weather[%d]: %w", i, err)
		}
		astro, err := first(day.Astronomy, fmt.Sprintf("weather[%d].astronomy", i))
		if err != nil {
			return nil, err
		}
		condition := ""
		if hour, err := first(day.Hourly, fmt.Sprintf("weather[%d].hourly", i)); err == nil {
			condition = namedValue(hour.WeatherDesc)
		}
		report.Forecast = append(report.Forecast, ForecastDay{
			Date:      day.Date,
			MinC:      minC,
			MaxC:      maxC,
			AvgC:      avgC,
			Sunrise:   astro.Sunrise,
			Sunset:    astro.Sunset,
			Condition: condition,
		})
	}
	return report, nil
}

func first[T any](items []T, field string) (T, error) {
	var zero T
	if len(items) == 0 {
		return zero, fmt.Errorf("wttr.in payload missing %s", field)
	}
	return items[0], nil
}

func namedValue(items []j1NamedVal) string {
	item, err := first(items, "named value")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(item.Value)
}

func parseIntField(field, raw string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("parse %s %q: %w", field, raw, err)
	}
	return n, nil
}
