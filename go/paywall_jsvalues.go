package solvapay

// JavaScript value semantics for the paywall code ported from the TypeScript
// SDK. The paywall builds its output from JSON with JavaScript's rules: a key
// that is missing (undefined) is not a key set to null, ?? falls through
// both, and 0 and "" are falsy. Porting with these helpers keeps every branch
// identical, which the conformance suite checks.
//
// Payloads are map[string]any as encoding/json decodes them (numbers are
// float64); json.Number and Go integers are read as numbers too.
//
// These helpers live in the paywall area's files but are not specific to it;
// another area porting TypeScript copy may reuse them.

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// jsUndefined is JavaScript's undefined: a key that is not there.
type jsUndefined struct{}

var undefined any = jsUndefined{}

func isUndefined(v any) bool { _, ok := v.(jsUndefined); return ok }

// nullish is v == null in JavaScript: null or undefined.
func nullish(v any) bool { return v == nil || isUndefined(v) }

// get is obj?.key: undefined when obj is not an object or the key is missing.
func get(obj any, key string) any {
	if m, ok := obj.(map[string]any); ok {
		if v, present := m[key]; present {
			return v
		}
	}
	return undefined
}

// coalesce is a ?? b ?? c.
func coalesce(values ...any) any {
	for _, v := range values[:len(values)-1] {
		if !nullish(v) {
			return v
		}
	}
	return values[len(values)-1]
}

// asNumber is v as a Go float64 when v is a JSON number.
func asNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil, jsUndefined:
		return false
	case bool:
		return x
	case string:
		return x != ""
	}
	if n, ok := asNumber(v); ok {
		return n != 0 && !math.IsNaN(n)
	}
	return true
}

// number is v as a JavaScript relational operator sees it: null is 0,
// undefined (and anything else not a number) is NaN.
func number(v any) float64 {
	if v == nil {
		return 0
	}
	if b, ok := v.(bool); ok {
		if b {
			return 1
		}
		return 0
	}
	if n, ok := asNumber(v); ok {
		return n
	}
	return math.NaN()
}

// nonEmptyString is `typeof v === 'string' && v.length > 0` (and v && v.length > 0).
func nonEmptyString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && s != ""
}

// jsString is String(v), as a template literal writes a value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case jsUndefined:
		return "undefined"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	}
	if n, ok := asNumber(v); ok {
		return jsNumberString(n)
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return "[object Object]"
	}
	return string(raw)
}

// jsNumberString is String(n) for the numbers payloads carry.
func jsNumberString(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n == 0:
		return "0"
	}
	abs := math.Abs(n)
	if abs >= 1e21 || abs < 1e-6 {
		text := strconv.FormatFloat(n, 'e', -1, 64)
		// Go writes 1e-07; JavaScript writes 1e-7.
		mantissa, exponent, _ := strings.Cut(text, "e")
		sign := exponent[0]
		digits := strings.TrimLeft(exponent[1:], "0")
		return mantissa + "e" + string(sign) + digits
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

// jsRound is Math.round: halves round toward +Infinity.
func jsRound(v float64) float64 { return math.Floor(v + 0.5) }

// roundDecimal rounds the decimal text of a non-negative number to digits
// fraction digits, halves away from zero, on the decimal digits (as Python's
// Decimal(repr(x)).quantize(ROUND_HALF_UP) does, and Intl does on the shortest
// representation). It returns the whole and fraction parts.
func roundDecimal(text string, digits int) (string, string) {
	whole, fraction, _ := strings.Cut(text, ".")
	if len(fraction) <= digits {
		return whole, fraction + strings.Repeat("0", digits-len(fraction))
	}
	roundUp := fraction[digits] >= '5'
	kept := []byte(whole + fraction[:digits])
	if roundUp {
		i := len(kept) - 1
		for ; i >= 0; i-- {
			if kept[i] == '9' {
				kept[i] = '0'
				continue
			}
			kept[i]++
			break
		}
		if i < 0 {
			kept = append([]byte{'1'}, kept...)
		}
	}
	split := len(kept) - digits
	return string(kept[:split]), string(kept[split:])
}

// plainDecimal is the shortest decimal text of a non-negative float64, without an exponent.
func plainDecimal(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// groupThousands writes 1234567 as 1,234,567.
func groupThousands(whole string) string {
	whole = strings.TrimLeft(whole, "0")
	if whole == "" {
		return "0"
	}
	var out strings.Builder
	for i, digit := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(digit)
	}
	return out.String()
}

// toLocaleString is n.toLocaleString('en-US'): grouped, at most 3 fraction
// digits, halves away from zero.
func toLocaleString(n float64) string {
	if math.IsNaN(n) {
		return "NaN"
	}
	if math.IsInf(n, 0) {
		if n > 0 {
			return "∞"
		}
		return "-∞"
	}
	whole, fraction := roundDecimal(plainDecimal(math.Abs(n)), 3)
	fraction = strings.TrimRight(fraction, "0")
	sign := ""
	if n < 0 && (strings.Trim(whole, "0") != "" || fraction != "") {
		sign = "-"
	}
	if fraction != "" {
		return sign + groupThousands(whole) + "." + fraction
	}
	return sign + groupThousands(whole)
}

// jsObject is an object literal as JSON.stringify writes it: undefined values drop out.
type jsObject map[string]any

func (o jsObject) set(key string, value any) {
	if !isUndefined(value) {
		o[key] = value
	}
}

// copyJSON is a shallow copy of a JSON object.
func copyJSON(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// jsStrictEqual is === for JSON scalars; objects and arrays are never equal
// here (they would be compared by identity in JavaScript).
func jsStrictEqual(a, b any) bool {
	switch a.(type) {
	case map[string]any, []any:
		return false
	}
	switch b.(type) {
	case map[string]any, []any:
		return false
	}
	if x, ok := asNumber(a); ok {
		y, ok := asNumber(b)
		return ok && x == y
	}
	return a == b
}
