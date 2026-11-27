package main

import "strings"

var earningsClaimMarkers = []string{"earnings growth", "earnings beat", "eps growth"}

var thinMarkers = []string{
	"we use several terms",
	"provided below",
	"see management's discussion",
	"item 7",
	"md&a",
}

// corroborateCatalyst checks a ranked row's catalyst against the company's
// last quarters of EPS beats and misses.
func corroborateCatalyst(row Object, earnings Object) Object {
	history, _ := earnings["history"].([]any)
	beats := 0
	var surprises []float64
	for _, item := range history {
		obj, ok := item.(Object)
		if !ok {
			continue
		}
		if strings.EqualFold(stringOf(obj["result"]), "beat") {
			beats++
		}
		if surprise, ok := obj["surprisePercent"].(float64); ok {
			surprises = append(surprises, surprise)
		}
	}
	quarters := len(history)
	mean := 0.0
	if len(surprises) > 0 {
		for _, s := range surprises {
			mean += s
		}
		mean /= float64(len(surprises))
	}
	claim := stringOf(row["catalyst_summary"])
	hasClaim := false
	for _, marker := range earningsClaimMarkers {
		if strings.Contains(strings.ToLower(claim), marker) {
			hasClaim = true
		}
	}
	verdict := "partially_corroborated"
	switch {
	case !hasClaim:
		verdict = "not_judged"
	case beats == 0:
		verdict = "contradicted"
	case quarters > 0 && beats == quarters:
		verdict = "corroborated"
	}
	return Object{
		"claim":                 claim,
		"beats":                 beats,
		"misses":                max(0, quarters-beats),
		"quarters":              quarters,
		"mean_surprise_percent": mean,
		"verdict":               verdict,
		"earnings_status":       earnings["status"],
	}
}

// filingsSince is the filings dated after the feed's last update (by day).
func filingsSince(feedLastUpdated string, recent any) []Object {
	cutoff := feedLastUpdated
	if len(cutoff) > 10 {
		cutoff = cutoff[:10]
	}
	items, _ := recent.([]any)
	flagged := []Object{}
	for _, item := range items {
		obj, ok := item.(Object)
		if !ok {
			continue
		}
		if stringOf(obj["filingDate"]) > cutoff {
			flagged = append(flagged, obj)
		}
	}
	return flagged
}

// classifySummary says whether a 10-K extract says anything ("substantive")
// or only points elsewhere ("thin").
func classifySummary(text string) string {
	lowered := strings.ToLower(text)
	for _, marker := range thinMarkers {
		if strings.Contains(lowered, marker) {
			return "thin"
		}
	}
	return "substantive"
}

// stringOf is a JSON value as text: "" for null or missing.
func stringOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
