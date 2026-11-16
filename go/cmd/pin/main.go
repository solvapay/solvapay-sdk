// Command pin adopts the current conformance cases for the Go SDK: it copies
// ../conformance/cases.lock to conformance.lock. With --check it fails instead
// when the pin is behind (the release check: a release passes every case of
// the commit it is built from). With --only <suite,...> it adopts only those
// suites' cases, for a port that is still catching up.
//
// Run from go/: go run ./cmd/pin [--check | --only webhook-verification]
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	check := flag.Bool("check", false, "fail when the pin is behind the lock")
	only := flag.String("only", "", "comma-separated suites to adopt (default: all)")
	flag.Parse()
	lockPath := filepath.Join("..", "conformance", "cases.lock")
	pinPath := "conformance.lock"
	lock, err := os.ReadFile(lockPath)
	if err != nil {
		fail(err)
	}
	if *check {
		pin, err := os.ReadFile(pinPath)
		if err != nil || !bytes.Equal(pin, lock) {
			fail(fmt.Errorf("go/conformance.lock is behind conformance/cases.lock: newer cases are not adopted. Make them pass, then run: go run ./cmd/pin"))
		}
		fmt.Println("The pin matches conformance/cases.lock")
		return
	}
	if *only == "" {
		if err := os.WriteFile(pinPath, lock, 0o644); err != nil {
			fail(err)
		}
		fmt.Println("Pinned conformance.lock to conformance/cases.lock")
		return
	}
	var data struct {
		Comment string            `json:"comment"`
		Cases   map[string]string `json:"cases"`
	}
	if err := json.Unmarshal(lock, &data); err != nil {
		fail(err)
	}
	keep := map[string]bool{}
	for _, suite := range strings.Split(*only, ",") {
		keep[strings.TrimSpace(suite)] = true
	}
	var existing struct {
		Cases map[string]string `json:"cases"`
	}
	if raw, err := os.ReadFile(pinPath); err == nil {
		_ = json.Unmarshal(raw, &existing)
	}
	adopted := map[string]string{}
	for where, fingerprint := range existing.Cases {
		adopted[where] = fingerprint
	}
	for where, fingerprint := range data.Cases {
		if keep[strings.SplitN(where, "/", 2)[0]] {
			adopted[where] = fingerprint
		}
	}
	keys := make([]string, 0, len(adopted))
	for k := range adopted {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	out.WriteString("{\n  \"comment\": \"Written by go run ./cmd/pin. Do not edit.\",\n  \"cases\": {\n")
	for i, k := range keys {
		sep := ","
		if i == len(keys)-1 {
			sep = ""
		}
		fmt.Fprintf(&out, "    %q: %q%s\n", k, adopted[k], sep)
	}
	out.WriteString("  }\n}\n")
	if err := os.WriteFile(pinPath, out.Bytes(), 0o644); err != nil {
		fail(err)
	}
	fmt.Printf("Pinned %d cases\n", len(keys))
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "pin:", err)
	os.Exit(1)
}
