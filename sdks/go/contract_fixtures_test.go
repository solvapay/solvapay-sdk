package solvapay_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/solvapay/solvapay-go/internal/contract"
)

const wantParsed, wantReplayed = 651, 651

var unsupportedFns = map[string]struct{}{}

func TestContractFixtureCensus(t *testing.T) {
	t.Helper()
	root, err := contract.FindRepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
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

	if replayed != wantReplayed {
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
