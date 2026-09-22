package main

import (
	"encoding/json"
	"fmt"
)

type GeoLocation struct {
	Name      string
	Country   string
	Admin1    string
	Latitude  float64
	Longitude float64
	Timezone  string
}

type CurrentConditions struct {
	Time                string
	Temperature         float64
	ApparentTemperature float64
	Humidity            int
	WindSpeed           float64
	WindDirection       int
	WindGusts           float64
	Precipitation       float64
	CloudCover          int
	IsDay               bool
	WeatherCode         int
	Condition           string
}

type DailyForecast struct {
	Date                     string
	MinC                     float64
	MaxC                     float64
	ApparentMinC             float64
	ApparentMaxC             float64
	PrecipitationSum         float64
	PrecipitationProbability int
	Sunrise                  string
	Sunset                   string
	UVIndexMax               float64
	WindSpeedMax             float64
	WeatherCode              int
	Condition                string
}

type HourlyForecast struct {
	Time                     string
	Temperature              float64
	PrecipitationProbability int
	WindSpeed                float64
	WeatherCode              int
	Condition                string
}

type ForecastData struct {
	Current CurrentConditions
	Daily   []DailyForecast
	Hourly  []HourlyForecast
}

type AirQualityCurrent struct {
	Time            string
	EuropeanAQI     *float64
	USAQI           *float64
	PM10            *float64
	PM25            *float64
	Ozone           *float64
	NitrogenDioxide *float64
}

type ArchiveDay struct {
	Date             string
	MinC             float64
	MaxC             float64
	ApparentMinC     float64
	ApparentMaxC     float64
	PrecipitationSum float64
	WindSpeedMax     float64
	WeatherCode      int
	Condition        string
}

type geocodePayload struct {
	Results []geocodeResult `json:"results"`
}

type geocodeResult struct {
	Name      string  `json:"name"`
	Country   string  `json:"country"`
	Admin1    string  `json:"admin1"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timezone  string  `json:"timezone"`
}

type forecastPayload struct {
	Current forecastCurrent `json:"current"`
	Daily   forecastDaily   `json:"daily"`
	Hourly  forecastHourly  `json:"hourly"`
}

type forecastCurrent struct {
	Time                string  `json:"time"`
	Temperature         float64 `json:"temperature_2m"`
	ApparentTemperature float64 `json:"apparent_temperature"`
	Humidity            int     `json:"relative_humidity_2m"`
	WindSpeed           float64 `json:"wind_speed_10m"`
	WindDirection       int     `json:"wind_direction_10m"`
	WindGusts           float64 `json:"wind_gusts_10m"`
	Precipitation       float64 `json:"precipitation"`
	CloudCover          int     `json:"cloud_cover"`
	IsDay               int     `json:"is_day"`
	WeatherCode         int     `json:"weather_code"`
}

type forecastDaily struct {
	Time                     []string  `json:"time"`
	WeatherCode              []int     `json:"weather_code"`
	TemperatureMax           []float64 `json:"temperature_2m_max"`
	TemperatureMin           []float64 `json:"temperature_2m_min"`
	ApparentMax              []float64 `json:"apparent_temperature_max"`
	ApparentMin              []float64 `json:"apparent_temperature_min"`
	Sunrise                  []string  `json:"sunrise"`
	Sunset                   []string  `json:"sunset"`
	UVIndexMax               []float64 `json:"uv_index_max"`
	PrecipitationSum         []float64 `json:"precipitation_sum"`
	PrecipitationProbability []int     `json:"precipitation_probability_max"`
	WindSpeedMax             []float64 `json:"wind_speed_10m_max"`
}

type forecastHourly struct {
	Time                     []string  `json:"time"`
	Temperature              []float64 `json:"temperature_2m"`
	PrecipitationProbability []int     `json:"precipitation_probability"`
	WeatherCode              []int     `json:"weather_code"`
	WindSpeed                []float64 `json:"wind_speed_10m"`
}

type airQualityPayload struct {
	Current airQualityCurrentRaw `json:"current"`
}

type airQualityCurrentRaw struct {
	Time            string   `json:"time"`
	EuropeanAQI     *float64 `json:"european_aqi"`
	USAQI           *float64 `json:"us_aqi"`
	PM10            *float64 `json:"pm10"`
	PM25            *float64 `json:"pm2_5"`
	Ozone           *float64 `json:"ozone"`
	NitrogenDioxide *float64 `json:"nitrogen_dioxide"`
}

type archivePayload struct {
	Daily forecastDaily `json:"daily"`
}

func weatherCodeText(code int) string {
	switch code {
	case 0:
		return "Clear sky"
	case 1:
		return "Mainly clear"
	case 2:
		return "Partly cloudy"
	case 3:
		return "Overcast"
	case 45:
		return "Fog"
	case 48:
		return "Depositing rime fog"
	case 51:
		return "Light drizzle"
	case 53:
		return "Moderate drizzle"
	case 55:
		return "Dense drizzle"
	case 56:
		return "Light freezing drizzle"
	case 57:
		return "Dense freezing drizzle"
	case 61:
		return "Slight rain"
	case 63:
		return "Moderate rain"
	case 65:
		return "Heavy rain"
	case 66:
		return "Light freezing rain"
	case 67:
		return "Heavy freezing rain"
	case 71:
		return "Slight snow fall"
	case 73:
		return "Moderate snow fall"
	case 75:
		return "Heavy snow fall"
	case 77:
		return "Snow grains"
	case 80:
		return "Slight rain showers"
	case 81:
		return "Moderate rain showers"
	case 82:
		return "Violent rain showers"
	case 85:
		return "Slight snow showers"
	case 86:
		return "Heavy snow showers"
	case 95:
		return "Thunderstorm"
	case 96:
		return "Thunderstorm with slight hail"
	case 99:
		return "Thunderstorm with heavy hail"
	default:
		return fmt.Sprintf("Unknown weather code %d", code)
	}
}

func decodeGeocode(raw []byte) (*GeoLocation, error) {
	var payload geocodePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode open-meteo geocode: %w", err)
	}
	if len(payload.Results) == 0 {
		return nil, fmt.Errorf("open-meteo geocode returned no results")
	}
	row := payload.Results[0]
	return &GeoLocation{
		Name:      row.Name,
		Country:   row.Country,
		Admin1:    row.Admin1,
		Latitude:  row.Latitude,
		Longitude: row.Longitude,
		Timezone:  row.Timezone,
	}, nil
}

func decodeForecast(raw []byte) (*ForecastData, error) {
	var payload forecastPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode open-meteo forecast: %w", err)
	}
	cur := payload.Current
	data := &ForecastData{
		Current: CurrentConditions{
			Time:                cur.Time,
			Temperature:         cur.Temperature,
			ApparentTemperature: cur.ApparentTemperature,
			Humidity:            cur.Humidity,
			WindSpeed:           cur.WindSpeed,
			WindDirection:       cur.WindDirection,
			WindGusts:           cur.WindGusts,
			Precipitation:       cur.Precipitation,
			CloudCover:          cur.CloudCover,
			IsDay:               cur.IsDay == 1,
			WeatherCode:         cur.WeatherCode,
			Condition:           weatherCodeText(cur.WeatherCode),
		},
		Daily:  dailyForecasts(payload.Daily),
		Hourly: hourlyForecasts(payload.Hourly),
	}
	return data, nil
}

func decodeAirQuality(raw []byte) (*AirQualityCurrent, error) {
	var payload airQualityPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode open-meteo air quality: %w", err)
	}
	cur := payload.Current
	return &AirQualityCurrent{
		Time:            cur.Time,
		EuropeanAQI:     cur.EuropeanAQI,
		USAQI:           cur.USAQI,
		PM10:            cur.PM10,
		PM25:            cur.PM25,
		Ozone:           cur.Ozone,
		NitrogenDioxide: cur.NitrogenDioxide,
	}, nil
}

func decodeArchive(raw []byte) ([]ArchiveDay, error) {
	var payload archivePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode open-meteo archive: %w", err)
	}
	days := make([]ArchiveDay, 0, len(payload.Daily.Time))
	for i := range payload.Daily.Time {
		code := indexInt(payload.Daily.WeatherCode, i)
		days = append(days, ArchiveDay{
			Date:             payload.Daily.Time[i],
			MinC:             indexFloat(payload.Daily.TemperatureMin, i),
			MaxC:             indexFloat(payload.Daily.TemperatureMax, i),
			ApparentMinC:     indexFloat(payload.Daily.ApparentMin, i),
			ApparentMaxC:     indexFloat(payload.Daily.ApparentMax, i),
			PrecipitationSum: indexFloat(payload.Daily.PrecipitationSum, i),
			WindSpeedMax:     indexFloat(payload.Daily.WindSpeedMax, i),
			WeatherCode:      code,
			Condition:        weatherCodeText(code),
		})
	}
	return days, nil
}

func dailyForecasts(daily forecastDaily) []DailyForecast {
	out := make([]DailyForecast, 0, len(daily.Time))
	for i := range daily.Time {
		code := indexInt(daily.WeatherCode, i)
		out = append(out, DailyForecast{
			Date:                     daily.Time[i],
			MinC:                     indexFloat(daily.TemperatureMin, i),
			MaxC:                     indexFloat(daily.TemperatureMax, i),
			ApparentMinC:             indexFloat(daily.ApparentMin, i),
			ApparentMaxC:             indexFloat(daily.ApparentMax, i),
			PrecipitationSum:         indexFloat(daily.PrecipitationSum, i),
			PrecipitationProbability: indexInt(daily.PrecipitationProbability, i),
			Sunrise:                  indexString(daily.Sunrise, i),
			Sunset:                   indexString(daily.Sunset, i),
			UVIndexMax:               indexFloat(daily.UVIndexMax, i),
			WindSpeedMax:             indexFloat(daily.WindSpeedMax, i),
			WeatherCode:              code,
			Condition:                weatherCodeText(code),
		})
	}
	return out
}

func hourlyForecasts(hourly forecastHourly) []HourlyForecast {
	out := make([]HourlyForecast, 0, len(hourly.Time))
	for i := range hourly.Time {
		code := indexInt(hourly.WeatherCode, i)
		out = append(out, HourlyForecast{
			Time:                     hourly.Time[i],
			Temperature:              indexFloat(hourly.Temperature, i),
			PrecipitationProbability: indexInt(hourly.PrecipitationProbability, i),
			WindSpeed:                indexFloat(hourly.WindSpeed, i),
			WeatherCode:              code,
			Condition:                weatherCodeText(code),
		})
	}
	return out
}

func indexFloat(values []float64, i int) float64 {
	if i >= len(values) {
		return 0
	}
	return values[i]
}

func indexInt(values []int, i int) int {
	if i >= len(values) {
		return 0
	}
	return values[i]
}

func indexString(values []string, i int) string {
	if i >= len(values) {
		return ""
	}
	return values[i]
}
