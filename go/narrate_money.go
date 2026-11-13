package solvapay

// Money and count formatting as the TypeScript SDK writes it with
// Intl.NumberFormat('en-US'), and the credit-display helpers of
// @solvapay/core (credit-display.ts). The currency prefixes and default
// fraction digits come from ICU through go/scripts/currencies.mjs.

//go:generate node scripts/currencies.mjs

import (
	"math"
	"strconv"
	"strings"
)

var zeroDecimalCurrencies = map[string]bool{
	"bif": true, "clp": true, "djf": true, "gnf": true, "jpy": true, "kmf": true, "krw": true, "mga": true,
	"pyg": true, "rwf": true, "ugx": true, "vnd": true, "vuv": true, "xaf": true, "xof": true, "xpf": true,
}

// IsZeroDecimalCurrency reports whether Stripe prices currency in whole units (JPY, KRW, ...).
func IsZeroDecimalCurrency(currency string) bool {
	return zeroDecimalCurrencies[strings.ToLower(currency)]
}

// MinorUnitsPerMajor is 1 for a zero-decimal currency, else 100.
func MinorUnitsPerMajor(currency string) float64 {
	if IsZeroDecimalCurrency(currency) {
		return 1
	}
	return 100
}

// CreditsToDisplayMinorUnits is the fiat value of a credit balance, in minor
// units of displayCurrency; false when creditsPerMinorUnit is not positive.
func CreditsToDisplayMinorUnits(credits, creditsPerMinorUnit, displayExchangeRate float64, displayCurrency string) (float64, bool) {
	if creditsPerMinorUnit == 0 || math.IsNaN(creditsPerMinorUnit) || creditsPerMinorUnit <= 0 {
		return 0, false
	}
	rate := displayExchangeRate
	if rate == 0 || math.IsNaN(rate) {
		rate = 1 // displayExchangeRate || 1
	}
	usdMajor := credits / creditsPerMinorUnit / 100
	return jsRound(usdMajor * rate * MinorUnitsPerMajor(displayCurrency)), true
}

// intlDecimal formats x as Intl.NumberFormat('en-US') does with these
// fraction digits: the shortest decimal that round-trips, rounded half away
// from zero, grouped by thousands. A negative x keeps its sign even when it
// rounds to zero ("-0"), as Intl does.
func intlDecimal(x float64, minFraction, maxFraction int) string {
	switch {
	case math.IsNaN(x):
		return "NaN"
	case math.IsInf(x, 1):
		return "∞"
	case math.IsInf(x, -1):
		return "-∞"
	}
	sign := ""
	if math.Signbit(x) {
		sign, x = "-", -x
	}
	text := roundDecimalHalfUp(strconv.FormatFloat(x, 'f', -1, 64), maxFraction)
	whole, fraction, _ := strings.Cut(text, ".")
	fraction = strings.TrimRight(fraction, "0")
	if len(fraction) < minFraction {
		fraction += strings.Repeat("0", minFraction-len(fraction))
	}
	out := groupThousands(whole)
	if fraction != "" {
		out += "." + fraction
	}
	return sign + out
}

func groupThousands(whole string) string {
	if len(whole) <= 3 {
		return whole
	}
	var b strings.Builder
	lead := len(whole) % 3
	if lead > 0 {
		b.WriteString(whole[:lead])
	}
	for i := lead; i < len(whole); i += 3 {
		if b.Len() > 0 {
			b.WriteByte(',')
		}
		b.WriteString(whole[i : i+3])
	}
	return b.String()
}

// formatCount is Intl.NumberFormat('en-US').format(Number(value)).
func formatCount(value any) string { return intlDecimal(jsNumber(value), 0, 3) }

func isWellFormedCurrencyCode(code string) bool {
	if len(code) != 3 {
		return false
	}
	for i := 0; i < 3; i++ {
		if c := code[i] | 0x20; c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

// FormatMinorAmount writes an amount in minor units as the TypeScript SDK's
// narration does: Intl.NumberFormat('en-US', { style: 'currency' }) with at
// most 0 fraction digits for a zero-decimal currency and 2 otherwise, and
// "<CODE> <amount.toFixed>" for a code Intl rejects.
func FormatMinorAmount(amountMinor float64, currency string) string {
	zero := IsZeroDecimalCurrency(currency)
	major, maxFraction := amountMinor/100, 2
	if zero {
		major, maxFraction = amountMinor, 0
	}
	code := strings.ToUpper(currency)
	if !isWellFormedCurrencyCode(code) {
		return code + " " + jsToFixed(major, maxFraction)
	}
	minFraction := 2
	if digits, ok := intlCurrencyDigits[code]; ok {
		minFraction = digits
	}
	minFraction = min(minFraction, maxFraction)
	prefix, ok := intlCurrencyPrefix[code]
	if !ok {
		prefix = code + " "
	}
	amount := intlDecimal(major, minFraction, maxFraction)
	if strings.HasPrefix(amount, "-") {
		return "-" + prefix + amount[1:]
	}
	return prefix + amount
}

// formatMoney is narrate.ts formatMoney: "" (null) without an amount or a currency.
func formatMoney(amountMinor, currency any) string {
	if jsNullish(amountMinor) || !jsTruthy(currency) {
		return ""
	}
	return FormatMinorAmount(jsNumber(amountMinor), jsString(currency))
}

// formatCompactMoney drops the first ".00" not followed by a digit: $29 rather than $29.00.
func formatCompactMoney(amountMinor, currency any) string {
	money := formatMoney(amountMinor, currency)
	for at := 0; ; {
		i := strings.Index(money[at:], ".00")
		if i < 0 {
			return money
		}
		end := at + i + 3
		if end == len(money) || money[end] < '0' || money[end] > '9' {
			return money[:at+i] + money[end:]
		}
		at += i + 1
	}
}
