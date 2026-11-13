package solvapay

// Money and credit display, matching @solvapay/core's credit-display helpers
// (Python: money.py). Shared-able: nothing here is paywall-specific.

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

var zeroDecimalCurrencies = map[string]bool{
	"bif": true, "clp": true, "djf": true, "gnf": true, "jpy": true, "kmf": true, "krw": true, "mga": true,
	"pyg": true, "rwf": true, "ugx": true, "vnd": true, "vuv": true, "xaf": true, "xof": true, "xpf": true,
}

// currencyPrefixes is what Intl.NumberFormat('en-US', { style: 'currency' })
// puts before an amount, where it is not the code and a no-break space
// (Node v24.22.1, ICU 78.3; the same table as python/src/solvapay/_currencies.py).
var currencyPrefixes = map[string]string{
	"AUD": "A$",
	"BRL": "R$",
	"CAD": "CA$",
	"CNY": "CN¥",
	"EUR": "€",
	"GBP": "£",
	"HKD": "HK$",
	"ILS": "₪",
	"INR": "₹",
	"JPY": "¥",
	"KRW": "₩",
	"MXN": "MX$",
	"NZD": "NZ$",
	"PHP": "₱",
	"TWD": "NT$",
	"USD": "$",
	"VND": "₫",
	"XAF": "FCFA ",
	"XCD": "EC$",
	"XCG": "Cg. ",
	"XOF": "F CFA ",
	"XPF": "CFPF ",
}

var currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)

// MinorUnitsPerMajor is 1 for zero-decimal currencies (JPY, KRW, …), else 100.
func MinorUnitsPerMajor(currency string) int {
	if zeroDecimalCurrencies[strings.ToLower(currency)] {
		return 1
	}
	return 100
}

// CreditsToDisplayMinorUnits is the fiat value of a credit balance, in minor
// units of displayCurrency; ok is false without a positive peg.
func CreditsToDisplayMinorUnits(credits, creditsPerMinorUnit, displayExchangeRate float64, displayCurrency string) (float64, bool) {
	if !(creditsPerMinorUnit > 0) {
		return 0, false
	}
	usdMajor := credits / creditsPerMinorUnit / 100
	rate := displayExchangeRate
	if rate == 0 || math.IsNaN(rate) {
		rate = 1
	}
	return jsRound(usdMajor * rate * float64(MinorUnitsPerMajor(displayCurrency))), true
}

// shiftLeft divides the decimal text of a non-negative number by 10^places.
func shiftLeft(text string, places int) string {
	whole, fraction, _ := strings.Cut(text, ".")
	for len(whole) <= places {
		whole = "0" + whole
	}
	cut := len(whole) - places
	return whole[:cut] + "." + whole[cut:] + fraction
}

// FormatMinor writes an amount in minor units as
// Intl.NumberFormat('en-US', { style: 'currency' }) does, with 0 decimals for
// zero-decimal currencies and 2 otherwise.
func FormatMinor(amountMinor float64, currency string) string {
	divisor := MinorUnitsPerMajor(currency)
	code := strings.ToUpper(currency)
	places := 2
	if divisor == 1 {
		places = 0
	}
	majorText := plainDecimal(math.Abs(amountMinor))
	if divisor != 1 {
		majorText = shiftLeft(majorText, 2)
	}
	if !currencyCode.MatchString(code) {
		// Intl throws on a malformed code; the TypeScript SDK then falls back to this.
		major, _ := strconv.ParseFloat(majorText, 64)
		if amountMinor < 0 {
			major = -major
		}
		if divisor == 1 {
			return code + " " + jsNumberString(jsRound(major))
		}
		return code + " " + strconv.FormatFloat(major, 'f', 2, 64)
	}
	whole, fraction := roundDecimal(majorText, places)
	sign := ""
	if amountMinor < 0 && (strings.Trim(whole, "0") != "" || strings.Trim(fraction, "0") != "") {
		sign = "-"
	}
	amount := groupThousands(whole)
	if places > 0 {
		amount += "." + fraction
	}
	prefix, ok := currencyPrefixes[code]
	if !ok {
		prefix = code + " "
	}
	return sign + prefix + amount
}
