// Package conformance runs the shared conformance cases (../../conformance)
// against the Go SDK. TypeScript is the reference: each case states what it
// does, and Go must do the same. Go runs the cases whose fingerprint in
// conformance/cases.lock matches go/conformance.lock (its pin); newer cases
// are skipped as not adopted, and publishing fails until the pin catches up.
//
// Each area registers its operations from its own file (ops_<area>_test.go),
// so parallel work never edits the same map.
package conformance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/solvapay/solvapay-sdk/go"
)

var (
	casesDir = filepath.Join("..", "..", "conformance", "cases")
	lockFile = filepath.Join("..", "..", "conformance", "cases.lock")
	pinFile  = filepath.Join("..", "conformance.lock")
	caseName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

// Operation runs one case's input. clock is the case's clock, or nil.
type Operation func(t *testing.T, args map[string]any, clock *time.Time) (any, error)

// ScenarioRunner runs a multi-step case and returns one outcome per step
// (each a map with result|error|gate and apiCalls), or ok=false when the
// scenario's setup is not one it handles.
type ScenarioRunner func(t *testing.T, data map[string]any) (outcomes []any, ok bool)

var (
	operations      = map[string]Operation{}
	scenarioRunners []ScenarioRunner
)

// register adds an operation; a name registered twice is a bug.
func register(name string, op Operation) {
	if _, taken := operations[name]; taken {
		panic("conformance: operation registered twice: " + name)
	}
	operations[name] = op
}

type loadedCase struct {
	where string
	data  map[string]any
}

func loadCases(t *testing.T) []loadedCase {
	t.Helper()
	suites, err := os.ReadDir(casesDir)
	if err != nil {
		t.Fatalf("reading %s: %v", casesDir, err)
	}
	var cases []loadedCase
	for _, suite := range suites {
		if !suite.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join(casesDir, suite.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			where := suite.Name() + "/" + file.Name()
			if !strings.HasSuffix(file.Name(), ".json") {
				t.Fatalf("%s: only .json files belong in a suite", where)
			}
			raw, err := os.ReadFile(filepath.Join(casesDir, suite.Name(), file.Name()))
			if err != nil {
				t.Fatal(err)
			}
			data, err := decodeJSON(raw)
			if err != nil {
				t.Fatalf("%s: %v", where, err)
			}
			fields := data.(map[string]any)
			name := strings.TrimSuffix(file.Name(), ".json")
			if fields["suite"] != suite.Name() || fields["case"] != name || !caseName.MatchString(name) {
				t.Fatalf("%s: suite or case does not match its path", where)
			}
			cases = append(cases, loadedCase{where: where, data: fields})
		}
	}
	if len(cases) == 0 {
		t.Fatalf("no conformance cases found in %s", casesDir)
	}
	return cases
}

func fingerprints(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	data, err := decodeJSON(raw)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	cases, ok := data.(map[string]any)["cases"].(map[string]any)
	if !ok {
		t.Fatalf("%s has no cases", path)
	}
	return cases
}

// decodeJSON keeps numbers exact (json.Number), so 2 and 2.0 stay apart.
func decodeJSON(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

// canonical is JSON with sorted keys (encoding/json sorts map keys), after a
// round trip so Go values and decoded expectations compare as JSON does.
func canonical(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encoding %#v: %v", value, err)
	}
	round, err := decodeJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(normaliseNumbers(round))
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// normaliseNumbers writes every number as JavaScript's JSON.stringify would:
// 2.0 is 2, 1e21 is 1e+21. The reference SDK is TypeScript, so its numbers win.
func normaliseNumbers(value any) any {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			v[key] = normaliseNumbers(item)
		}
		return v
	case []any:
		for i, item := range v {
			v[i] = normaliseNumbers(item)
		}
		return v
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return json.RawMessage(jsNumber(f))
		}
		return v
	default:
		return v
	}
}

func jsNumber(f float64) string {
	raw, _ := json.Marshal(f)
	text := string(raw)
	// encoding/json writes 1e21 as 1e+21 already; JS writes small exponents the same way.
	return text
}

// outcome turns a result or an *solvapay.Error into a case's expect shape.
func outcome(t *testing.T, where string, result any, err error) map[string]any {
	t.Helper()
	if err != nil {
		var sdkErr *solvapay.Error
		if errors.As(err, &sdkErr) {
			return map[string]any{"error": map[string]any{"code": sdkErr.Code}}
		}
		t.Fatalf("%s: an error without a code is a bug, not an outcome: %v", where, err)
	}
	return map[string]any{"result": result}
}

func TestEveryCaseIsLocked(t *testing.T) {
	locked := fingerprints(t, lockFile)
	var missing []string
	for _, c := range loadCases(t) {
		if _, ok := locked[c.where]; !ok {
			missing = append(missing, c.where)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("conformance/cases.lock has no fingerprint for %v; run the TypeScript runner's record", missing)
	}
}

func TestConformance(t *testing.T) {
	locked := fingerprints(t, lockFile)
	pinned := fingerprints(t, pinFile)
	cases := loadCases(t)
	sort.Slice(cases, func(i, j int) bool { return cases[i].where < cases[j].where })
	for _, c := range cases {
		c := c
		t.Run(c.where, func(t *testing.T) {
			if pinned[c.where] == nil || fmt.Sprint(pinned[c.where]) != fmt.Sprint(locked[c.where]) {
				t.Skip("not adopted: newer than go/conformance.lock")
			}
			if steps, ok := c.data["steps"].([]any); ok {
				runScenario(t, c, steps)
				return
			}
			input := c.data["input"].(map[string]any)
			fn := input["fn"].(string)
			op, ok := operations[fn]
			if !ok {
				t.Fatalf("no Go mapping for fn %q", fn)
			}
			var clock *time.Time
			if text, ok := input["clock"].(string); ok {
				parsed, err := time.Parse(time.RFC3339Nano, text)
				if err != nil {
					t.Fatalf("clock %q: %v", text, err)
				}
				clock = &parsed
			}
			result, err := op(t, input["args"].(map[string]any), clock)
			got := canonical(t, outcome(t, c.where, result, err))
			want := canonical(t, c.data["expect"])
			if got != want {
				t.Fatalf("%s: %s\nexpected: %s\nactual:   %s", c.where, c.data["description"], want, got)
			}
		})
	}
}

func runScenario(t *testing.T, c loadedCase, steps []any) {
	t.Helper()
	for _, run := range scenarioRunners {
		outcomes, ok := run(t, c.data)
		if !ok {
			continue
		}
		if len(outcomes) != len(steps) {
			t.Fatalf("%s: %d steps, %d outcomes", c.where, len(steps), len(outcomes))
		}
		for i, step := range steps {
			want := canonical(t, step.(map[string]any)["expect"])
			got := canonical(t, outcomes[i])
			if got != want {
				t.Fatalf("%s step %d (%v): %s\nexpected: %s\nactual:   %s", c.where, i+1, step.(map[string]any)["fn"], c.data["description"], want, got)
			}
		}
		return
	}
	t.Fatalf("%s: no Go scenario runner handles this setup", c.where)
}
