package solvapay_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/solvapay/solvapay-sdk/sdks/go/internal/dispatch"
	"github.com/solvapay/solvapay-sdk/sdks/go/internal/livecontract"
)

type fixtureFile struct {
	Suite  string          `json:"suite"`
	Case   string          `json:"case"`
	Input  fixtureInput    `json:"input"`
	Expect json.RawMessage `json:"expect"`
}

type fixtureInput struct {
	Fn string `json:"fn"`
}

type expectResult struct {
	Result json.RawMessage `json:"result"`
	Error  *expectError    `json:"error"`
}

type expectError struct {
	Message string `json:"message"`
}

func isRoutedClientOp(fn string) bool {
	return !strings.HasPrefix(fn, "mcp") && fn != "fetchJwks"
}

func TestFacadeInventoryHasSuccessAndErrorPerOperation(t *testing.T) {
	fixtures := loadClientFixtures(t)
	success := map[string]bool{}
	errorCases := map[string]bool{}
	for _, f := range fixtures {
		var expect expectResult
		if err := json.Unmarshal(f.Expect, &expect); err != nil {
			t.Fatalf("unmarshal expect: %v", err)
		}
		if expect.Error != nil {
			errorCases[f.Input.Fn] = true
		} else {
			success[f.Input.Fn] = true
		}
	}
	for _, sig := range operationSignatures {
		fn := dispatch.ToCamel(sig.name)
		if !isRoutedClientOp(fn) {
			continue
		}
		if !success[fn] {
			t.Errorf("missing success fixture for %s", fn)
		}
		if !errorCases[fn] {
			t.Errorf("missing error fixture for %s", fn)
		}
	}
}

func TestLiveScenariosCoverEveryOperationSignature(t *testing.T) {
	ops := map[string]struct{}{}
	for _, s := range livecontract.SCENARIOS {
		ops[s.Op] = struct{}{}
	}
	for _, sig := range operationSignatures {
		fn := dispatch.ToCamel(sig.name)
		if !isRoutedClientOp(fn) {
			continue
		}
		if _, ok := ops[fn]; !ok {
			t.Errorf("SCENARIOS missing coverage for operationSignatures op %s", fn)
		}
	}
}

func TestDispatchSignaturesMatchOperationSignatures(t *testing.T) {
	if len(dispatch.Signatures) != len(operationSignatures) {
		t.Fatalf("dispatch.Signatures len = %d, operationSignatures len = %d",
			len(dispatch.Signatures), len(operationSignatures))
	}
	for i, want := range operationSignatures {
		got := dispatch.Signatures[i]
		if got.Name != want.name {
			t.Fatalf("Signatures[%d].Name = %q, want %q", i, got.Name, want.name)
		}
		if !reflect.DeepEqual(got.Params, want.params) {
			t.Fatalf("Signatures[%d].Params = %#v, want %#v", i, got.Params, want.params)
		}
	}
}

func signatureFor(name string) (operationSignature, bool) {
	for _, sig := range operationSignatures {
		if sig.name == name {
			return sig, true
		}
	}
	return operationSignature{}, false
}

func loadClientFixtures(t *testing.T) []fixtureFile {
	t.Helper()
	root := fixturesRoot(t)
	var out []fixtureFile
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var fixture fixtureFile
		if err := json.Unmarshal(raw, &fixture); err != nil {
			return err
		}
		if fixture.Suite != "client" {
			return nil
		}
		if _, ok := signatureFor(dispatch.ToPascal(fixture.Input.Fn)); !ok {
			return nil
		}
		out = append(out, fixture)
		return nil
	})
	if err != nil {
		t.Fatalf("walk fixtures: %v", err)
	}
	return out
}

func fixturesRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "contract", "fixtures", "client"))
	if err != nil {
		t.Fatalf("fixtures root: %v", err)
	}
	return root
}
