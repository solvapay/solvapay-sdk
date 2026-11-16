package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// loadDotEnv sets KEY=value lines from path, leaving variables already set
// alone. A missing file is fine: in production the host sets the variables.
func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s: not KEY=value: %q", path, line)
		}
		key = strings.TrimSpace(key)
		if _, set := os.LookupEnv(key); !set {
			if err := os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`)); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}
