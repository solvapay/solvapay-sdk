package solvapay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultAPIBaseURL is SolvaPay's production API.
	DefaultAPIBaseURL = "https://api.solvapay.com"
	// DefaultMaxRetries is how many times a retryable request is sent again.
	DefaultMaxRetries = 2
	// Version is this SDK's version, sent in the User-Agent.
	Version = "0.0.0-dev"
)

// Statuses worth a retry: rate limited, or the platform briefly unavailable.
var retryStatuses = map[int]bool{429: true, 502: true, 503: true, 504: true}

// sleep waits between retries; tests replace it.
var sleep = func(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// Config configures a Client. Empty fields fall back to the environment
// (SOLVAPAY_SECRET_KEY, SOLVAPAY_API_BASE_URL); a missing key is an error.
type Config struct {
	APIKey     string
	APIBaseURL string
	// MaxRetries for reads and idempotent writes; nil means DefaultMaxRetries.
	MaxRetries *int
	// Timeout per request; zero means 30 seconds.
	Timeout    time.Duration
	HTTPClient *http.Client
}

// Client talks to the SolvaPay SDK API.
type Client struct {
	baseURL    string
	apiKey     string
	maxRetries int
	http       *http.Client
}

// NewClient builds a Client, failing with missing_secret when there is no key.
func NewClient(config Config) (*Client, error) {
	key := config.APIKey
	if key == "" {
		key = os.Getenv("SOLVAPAY_SECRET_KEY")
	}
	if key == "" {
		return nil, newError("missing_secret", "A SolvaPay secret key is required: set Config.APIKey or SOLVAPAY_SECRET_KEY.")
	}
	base := config.APIBaseURL
	if base == "" {
		base = os.Getenv("SOLVAPAY_API_BASE_URL")
	}
	if base == "" {
		base = DefaultAPIBaseURL
	}
	retries := DefaultMaxRetries
	if config.MaxRetries != nil {
		retries = *config.MaxRetries
	}
	if retries < 0 {
		return nil, newError("invalid_argument", "MaxRetries cannot be negative")
	}
	client := config.HTTPClient
	if client == nil {
		timeout := config.Timeout
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}
	return &Client{
		baseURL:    strings.TrimRight(base, "/"),
		apiKey:     key,
		maxRetries: retries,
		http:       client,
	}, nil
}

// PathSegment is a path parameter, percent-encoded so a reference can never
// change the path. An empty value is an error.
func PathSegment(value string) (string, error) {
	if value == "" {
		return "", newError("invalid_argument", "A path parameter is empty")
	}
	return url.PathEscape(value), nil
}

// Request sends one API request and returns its JSON body (nil for an empty
// answer). Reads, and writes with an Idempotency-Key header, are retried on
// 429, 502, 503 and 504 and on network errors, honouring Retry-After.
func (c *Client) Request(ctx context.Context, method, path string, query url.Values, headers http.Header, body any) (json.RawMessage, error) {
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, &Error{Code: "invalid_argument", Message: fmt.Sprintf("The request body cannot be encoded: %v", err)}
		}
		payload = encoded
	}
	target := c.baseURL + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	retries := 0
	if method == http.MethodGet || method == http.MethodHead || headers.Get("Idempotency-Key") != "" {
		retries = c.maxRetries
	}
	for attempt := 0; ; attempt++ {
		request, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(payload))
		if err != nil {
			return nil, &Error{Code: "invalid_argument", Message: err.Error()}
		}
		request.Header.Set("Authorization", "Bearer "+c.apiKey)
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "solvapay-go/"+Version)
		if payload != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		for name, values := range headers {
			for _, value := range values {
				request.Header.Add(name, value)
			}
		}
		response, err := c.http.Do(request)
		if err != nil {
			if attempt < retries {
				if waitErr := sleep(ctx, retryAfter(nil, attempt)); waitErr != nil {
					return nil, &Error{Code: "network_error", Message: waitErr.Error()}
				}
				continue
			}
			return nil, &Error{Code: "network_error", Message: fmt.Sprintf("Could not reach the SolvaPay API: %v", err)}
		}
		data, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			return nil, &Error{Code: "network_error", Message: fmt.Sprintf("Could not read the SolvaPay API's answer: %v", readErr), Status: response.StatusCode}
		}
		if retryStatuses[response.StatusCode] && attempt < retries {
			if waitErr := sleep(ctx, retryAfter(response, attempt)); waitErr != nil {
				return nil, &Error{Code: "network_error", Message: waitErr.Error()}
			}
			continue
		}
		if response.StatusCode >= 400 {
			apiErr := errorFromResponse(response.StatusCode, data)
			apiErr.answer = &apiAnswer{method: method, path: path, contentType: response.Header.Get("Content-Type"), body: data}
			return nil, apiErr
		}
		return result(response.StatusCode, data)
	}
}

// apiAnswer is the failed exchange an *Error came from, kept so the web routes
// can describe a failure as TypeScript's client does
// ("<Operation> failed (<status>): <body>").
type apiAnswer struct {
	method      string
	path        string
	contentType string
	body        []byte
}

func retryAfter(response *http.Response, attempt int) time.Duration {
	if response != nil {
		if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds >= 0 {
			return time.Duration(min(seconds, 30)) * time.Second
		}
	}
	return time.Duration(500*(1<<attempt)) * time.Millisecond
}

func result(status int, data []byte) (json.RawMessage, error) {
	if status >= 400 {
		return nil, errorFromResponse(status, data)
	}
	if status == http.StatusNoContent || len(data) == 0 {
		return nil, nil
	}
	if !json.Valid(data) {
		return nil, &Error{Code: "non_json_response", Status: status, Message: fmt.Sprintf("The SolvaPay API answered %d with a body that is not JSON", status), Body: snippet(data)}
	}
	return json.RawMessage(data), nil
}

func errorFromResponse(status int, data []byte) *Error {
	var body any
	if err := json.Unmarshal(data, &body); err != nil {
		text := snippet(data)
		return &Error{Code: "non_json_response", Status: status, Message: fmt.Sprintf("The SolvaPay API answered %d with a body that is not JSON: %s", status, text), Body: text}
	}
	message := ""
	code := ""
	if fields, ok := body.(map[string]any); ok {
		switch m := fields["message"].(type) {
		case string:
			message = m
		case []any:
			parts := make([]string, len(m))
			for i, part := range m {
				parts[i] = fmt.Sprint(part)
			}
			message = strings.Join(parts, "; ")
		}
		// Only a non-empty string is the API's own code, as in the other SDKs.
		if c, ok := fields["code"].(string); ok && c != "" {
			code = c
		}
	}
	if message == "" {
		message = fmt.Sprintf("The SolvaPay API answered %d", status)
	}
	if code == "" {
		code = fmt.Sprintf("http_%d", status)
	}
	return &Error{Code: code, Status: status, Message: message, Body: body}
}

func snippet(data []byte) string {
	text := string(data)
	if len([]rune(text)) > 240 {
		text = string([]rune(text)[:240])
	}
	return text
}

// Decode reads a JSON answer into out, failing with invalid_response when the
// API sent something this SDK cannot read.
func Decode[T any](raw json.RawMessage) (T, error) {
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, &Error{Code: "invalid_response", Message: fmt.Sprintf("The SolvaPay API answered with something this SDK cannot read: %v", err), Body: string(raw)}
	}
	return out, nil
}
