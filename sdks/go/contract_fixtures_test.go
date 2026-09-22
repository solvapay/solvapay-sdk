package solvapay_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/solvapay/solvapay-sdk/sdks/go/internal/contract"
)

type fixtureCensus struct {
	Parsed    int `json:"parsed"`
	Delegated int `json:"delegated"`
}

func loadFixtureCensus(t *testing.T, root string) (wantParsed, wantReplayed int) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "contract", "fixtures", "census.generated.json"))
	if err != nil {
		t.Fatal(err)
	}
	var census fixtureCensus
	if err := json.Unmarshal(raw, &census); err != nil {
		t.Fatal(err)
	}
	if census.Parsed <= 0 {
		t.Fatal("census.parsed must be positive")
	}
	// Delegated fixtures are host loops the Rust runner does not execute.
	// The Go guest replays them. unsupportedFns is the only way to exclude one.
	return census.Parsed, census.Parsed
}

// Declared skips only. An empty map means every discovered fixture is replayed.
// Do not add a bare continue above the lookup.
var unsupportedFns = map[string]struct{}{}

func TestContractFixtureCensus(t *testing.T) {
	t.Helper()
	root, err := contract.FindRepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	wantParsed, wantReplayed := loadFixtureCensus(t, root)
	files, err := contract.DiscoverFixtureFiles(filepath.Join(root, "contract", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != wantParsed {
		t.Fatalf("parsed fixture count = %d, want %d", len(files), wantParsed)
	}

	ctx := context.Background()
	replayed := 0
	seenUnsupported := map[string]int{}
	var failures []string

	for _, path := range files {
		fixture, err := contract.LoadFixture(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		rel, _ := filepath.Rel(filepath.Join(root, "contract", "fixtures"), path)
		_, listed := unsupportedFns[fixture.Input.Fn]
		outcome, err := contract.Replay(ctx, fixture)
		if listed {
			if !errors.Is(err, contract.ErrUnsupported) {
				failures = append(failures, rel+": listed in unsupportedFns but replayed: "+errString(err))
			}
			seenUnsupported[fixture.Input.Fn]++
			continue
		}
		if errors.Is(err, contract.ErrUnsupported) {
			failures = append(failures, rel+": unlisted fn "+fixture.Input.Fn+" is unsupported")
			continue
		}
		if err != nil {
			failures = append(failures, rel+": "+err.Error())
			continue
		}
		if err := contract.AssertExpect(outcome, fixture); err != nil {
			failures = append(failures, rel+": "+err.Error())
			continue
		}
		replayed++
	}

	skipped := 0
	for _, n := range seenUnsupported {
		skipped += n
	}
	if replayed != wantReplayed-skipped {
		failures = append(failures, "replayed count mismatch")
	}
	for fn := range unsupportedFns {
		if seenUnsupported[fn] == 0 {
			failures = append(failures, "unsupportedFns lists "+fn+" but no fixture uses it")
		}
	}
	if len(failures) > 0 {
		t.Fatalf("fixture census failed (parsed=%d replayed=%d wantReplayed=%d, %d issues):\n%s",
			len(files), replayed, wantReplayed, len(failures), joinLines(failures))
	}
}

func errString(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}

func joinLines(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += "\n"
		}
		out += item
	}
	return out
}
