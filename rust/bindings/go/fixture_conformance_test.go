package solvapay_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
	"github.com/solvapay/solvapay-go/internal/dispatch"
	"github.com/solvapay/solvapay-go/internal/livecontract"
)

type fixtureFile struct {
	Suite  string          `json:"suite"`
	Case   string          `json:"case"`
	Input  fixtureInput    `json:"input"`
	Wire   *fixtureWire    `json:"wire"`
	Expect json.RawMessage `json:"expect"`
}

type fixtureInput struct {
	Fn   string         `json:"fn"`
	Args map[string]any `json:"args"`
}

type fixtureWire struct {
	Request  fixtureWireRequest  `json:"request"`
	Response fixtureWireResponse `json:"response"`
}

type fixtureWireRequest struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

type fixtureWireResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

type expectResult struct {
	Result json.RawMessage `json:"result"`
	Error  *expectError    `json:"error"`
}

type expectError struct {
	Name    string `json:"name"`
	Message string `json:"message"`
	Status  *int   `json:"status"`
}

func TestFacadeInventoryHasSuccessAndErrorPerOperation(t *testing.T) {
	fixtures := loadClientFixtures(t)
	success := map[string]bool{}
	errorCases := map[string]bool{}
	for _, f := range fixtures {
		var expect expectResult
		if err := json.Unmarshal(f.Expect, &expect); err != nil {
			t.Fatalf("%s: parse expect: %v", f.Case, err)
		}
		if expect.Error != nil {
			errorCases[f.Input.Fn] = true
		} else {
			success[f.Input.Fn] = true
		}
	}
	for _, sig := range operationSignatures {
		fn := dispatch.ToCamel(sig.name)
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

func TestFacadeReplaysPhase0ClientFixtures(t *testing.T) {
	fixtures := loadClientFixtures(t)
	if len(fixtures) == 0 {
		t.Fatal("no client fixtures discovered")
	}
	var failures []string
	for _, fixture := range fixtures {
		if err := replayFixture(t, fixture); err != nil {
			failures = append(failures, fixture.Case+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		t.Fatalf("facade fixture failures (%d):\n%s", len(failures), strings.Join(failures, "\n"))
	}
}

func replayFixture(t *testing.T, fixture fixtureFile) error {
	t.Helper()
	ctx := context.Background()

	var server *httptest.Server
	baseURL := "http://127.0.0.1:1"
	if fixture.Wire != nil {
		wire := fixture.Wire
		server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != wire.Request.Path {
				http.Error(w, "unexpected path "+r.URL.Path, http.StatusBadRequest)
				return
			}
			if wire.Request.Method != "" && r.Method != wire.Request.Method {
				http.Error(w, "unexpected method "+r.Method, http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(wire.Response.Status)
			body := wire.Response.Body
			if len(body) > 0 && body[0] == '"' {
				var s string
				if err := json.Unmarshal(body, &s); err == nil {
					_, _ = io.WriteString(w, s)
					return
				}
			}
			_, _ = w.Write(body)
		}))
		defer server.Close()
		baseURL = server.URL
	}

	client, err := solvapay.NewClient(ctx, "sk_test_fixture", solvapay.WithBaseURL(baseURL))
	if err != nil {
		return err
	}
	defer func() { _ = client.Close(ctx) }()

	value, callErr := dispatch.Call(client, ctx, fixture.Input.Fn, fixture.Input.Args)
	return assertExpect(fixture.Expect, value, callErr)
}

func assertExpect(raw json.RawMessage, value any, callErr error) error {
	var expect expectResult
	if err := json.Unmarshal(raw, &expect); err != nil {
		return err
	}
	if expect.Error != nil {
		if callErr == nil {
			return errors.New("expected error, got success")
		}
		var svErr *solvapay.Error
		if !errors.As(callErr, &svErr) {
			return errors.New("error is not *solvapay.Error: " + callErr.Error())
		}
		if expect.Error.Message != "" && svErr.Message != expect.Error.Message {
			// Allow prefix/contains match when guest message formatting differs slightly.
			if !strings.Contains(svErr.Message, expect.Error.Message) &&
				!strings.Contains(expect.Error.Message, svErr.Message) {
				return errors.New("error message = " + svErr.Message + ", want " + expect.Error.Message)
			}
		}
		if expect.Error.Status != nil && svErr.Status != *expect.Error.Status {
			return errors.New("error status mismatch")
		}
		return nil
	}
	if callErr != nil {
		return callErr
	}
	wantBytes, err := json.Marshal(expect.Result)
	if err != nil {
		return err
	}
	var want any
	if err := json.Unmarshal(wantBytes, &want); err != nil {
		return err
	}
	gotBytes, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var got any
	if err := json.Unmarshal(gotBytes, &got); err != nil {
		return err
	}
	if !reflect.DeepEqual(got, want) {
		return errors.New("result mismatch: got " + string(gotBytes) + " want " + string(wantBytes))
	}
	return nil
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
	// rust/bindings/go → repo root is ../../..
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "contract", "fixtures", "client"))
	if err != nil {
		t.Fatalf("fixtures root: %v", err)
	}
	return root
}
