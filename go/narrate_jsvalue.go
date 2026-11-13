package solvapay

// JavaScript value semantics, for the narration and pricing code ported from
// the TypeScript SDK. That code reads loosely typed JSON with JavaScript's
// rules: a missing key (undefined) is not a key set to null, `??` falls
// through both, 0 and "" are falsy, and numbers print as String(n) does.
// Porting with these helpers keeps every branch identical; the conformance
// cases check it.
//
// Values are what encoding/json decodes into `any`: nil, bool, float64 (or
// json.Number), string, []any and map[string]any.

import (
	"encoding/json"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

type jsUndefinedType struct{}

// jsUndefined is JavaScript undefined: a key that is not there. nil is null.
var jsUndefined any = jsUndefinedType{}

// jsGet is obj?.key: jsUndefined when obj is not an object or lacks the key.
func jsGet(obj any, key string) any {
	if m, ok := obj.(map[string]any); ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return jsUndefined
}

func jsNullish(v any) bool { return v == nil || v == jsUndefined }

// jsCoalesce is a ?? b ?? c: the first value neither null nor undefined, else the last.
func jsCoalesce(values ...any) any {
	for _, v := range values[:len(values)-1] {
		if !jsNullish(v) {
			return v
		}
	}
	return values[len(values)-1]
}

// jsNum is `typeof v === 'number'`, with the value.
func jsNum(v any) (float64, bool) {
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

func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil, jsUndefinedType:
		return false
	case bool:
		return x
	case string:
		return x != ""
	}
	if n, ok := jsNum(v); ok {
		return n != 0 && !math.IsNaN(n)
	}
	return true
}

// jsNumber is Number(v), as a relational operator or arithmetic sees v:
// null is 0, undefined is NaN, a numeric string is its number.
func jsNumber(v any) float64 {
	if n, ok := jsNum(v); ok {
		return n
	}
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		text := jsTrim(x)
		if text == "" {
			return 0
		}
		switch text {
		case "Infinity", "+Infinity":
			return math.Inf(1)
		case "-Infinity":
			return math.Inf(-1)
		}
		// Decimal only: Go also parses "inf", "nan", hex floats and underscores.
		if strings.Trim(text, "0123456789.eE+-") == "" {
			if parsed, err := strconv.ParseFloat(text, 64); err == nil {
				return parsed
			}
		}
	}
	return math.NaN()
}

// jsString is String(v) for the values a template literal interpolates.
func jsString(v any) string {
	if n, ok := jsNum(v); ok {
		return jsNumberString(n)
	}
	switch x := v.(type) {
	case nil:
		return "null"
	case jsUndefinedType:
		return "undefined"
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			if !jsNullish(item) {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumberString is Number.prototype.toString(): shortest round-trip digits,
// exponent form below 1e-6 and from 1e21.
func jsNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	mantissa, exp, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(exp)
	k, n := len(digits), e+1
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	out := digits[:1]
	if k > 1 {
		out += "." + digits[1:]
	}
	if n-1 >= 0 {
		return sign + out + "e+" + strconv.Itoa(n-1)
	}
	return sign + out + "e" + strconv.Itoa(n-1)
}

// jsRound is Math.round: halves round toward +Infinity.
func jsRound(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}

// jsToFixed is Number.prototype.toFixed(digits): the exact binary value,
// rounded half up (away from zero), never in exponent form below 1e21.
func jsToFixed(x float64, digits int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.Abs(x) >= 1e21 || math.IsInf(x, 0) {
		return jsNumberString(x)
	}
	sign := ""
	if x < 0 {
		sign, x = "-", -x
	}
	exact := new(big.Float).SetFloat64(x).Text('f', 1100)
	text := roundDecimalHalfUp(exact, digits)
	return sign + padFraction(text, digits)
}

// roundDecimalHalfUp rounds a non-negative decimal string to at most digits
// fraction digits, half up.
func roundDecimalHalfUp(text string, digits int) string {
	whole, fraction, _ := strings.Cut(text, ".")
	if len(fraction) <= digits {
		return text
	}
	up := fraction[digits] >= '5'
	kept := []byte(whole + fraction[:digits])
	if up {
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
	if digits == 0 {
		return string(kept)
	}
	return string(kept[:split]) + "." + string(kept[split:])
}

func padFraction(text string, digits int) string {
	if digits == 0 {
		return text
	}
	whole, fraction, _ := strings.Cut(text, ".")
	return whole + "." + fraction + strings.Repeat("0", digits-len(fraction))
}

// isJSWhitespace is JavaScript's WhiteSpace and LineTerminator, what trim() strips.
func isJSWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsTrim is String.prototype.trim (Go's TrimSpace strips U+0085 and keeps U+FEFF).
func jsTrim(s string) string { return strings.TrimFunc(s, isJSWhitespace) }

// jsLength is String.prototype.length: UTF-16 code units, not runes.
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }

// parseJSDate is new Date(iso) for the ISO 8601 strings the API sends; false
// when it is not one. A time without an offset is read as UTC (JavaScript
// reads it in the host's zone; the API always sends one).
func parseJSDate(v any) (time.Time, bool) {
	text, ok := v.(string)
	if !ok || text == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04",
		"2006-01-02",
		"2006-01",
		"2006",
	} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.Truncate(time.Millisecond), true
		}
	}
	return time.Time{}, false
}

// jsonValue turns any Go value into what encoding/json decodes into `any`, so
// a struct (a generated API model, say) reads like the JSON it marshals to.
func jsonValue(v any) (any, error) {
	switch v.(type) {
	case nil, map[string]any, []any, string, bool, float64:
		return v, nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}
