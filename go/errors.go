// Package solvapay is the SolvaPay Go SDK: the API client, paywall, webhooks
// and MCP server, behaving as the TypeScript SDK does (the shared conformance
// cases in ../conformance say how).
package solvapay

import (
	"errors"
	"fmt"
)

// Error is every error the SDK returns. Branch on Code (a stable identifier)
// and Status (the HTTP status, when the error came from the API), never on
// Message, which is for people and may change.
type Error struct {
	Code    string
	Message string
	Status  int
	Body    any
}

func (e *Error) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("solvapay: %s (%s, status %d)", e.Message, e.Code, e.Status)
	}
	return fmt.Sprintf("solvapay: %s (%s)", e.Message, e.Code)
}

// ErrorCode is the Code of err when it is (or wraps) an *Error, else "".
func ErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func newError(code, message string) *Error {
	return &Error{Code: code, Message: message}
}
