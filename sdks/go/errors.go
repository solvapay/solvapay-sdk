package solvapay

import "fmt"

// Error is the structured failure surface returned by every SolvaPay call.
//
// It mirrors the guest `SdkError` envelope: Code carries the stable machine
// code (webhook errors use snake_case codes such as "invalid_signature";
// other kinds fall back to the serde `kind` tag), and Message is the
// human-readable text. Use errors.As to inspect it:
//
//	var svErr *solvapay.Error
//	if errors.As(err, &svErr) && svErr.Code == "invalid_signature" { ... }
type Error struct {
	// Code is the stable machine-readable code (or the SdkError kind).
	Code string
	// Message is the human-readable error message.
	Message string
	// Status is the HTTP status for API errors, when present.
	Status int
	// Retryable reports whether a transport error may succeed on retry.
	Retryable bool
}

// Error implements the error interface.
func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("solvapay: %s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("solvapay: %s", e.Message)
}
