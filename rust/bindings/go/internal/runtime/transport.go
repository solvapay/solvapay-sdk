package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

// httpClient services guest transport requests. It is a package var so tests
// can tighten timeouts if needed; the default has no timeout because callers
// drive cancellation through the request context.
var httpClient = &http.Client{}

// wireRequest mirrors the guest's host_transport::WireRequest.
type wireRequest struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Headers [][2]string `json:"headers"`
	Body    *string     `json:"body,omitempty"`
}

// wireResponse mirrors the guest's host_transport::WireResponse.
type wireResponse struct {
	Status uint16 `json:"status"`
	Body   string `json:"body"`
}

// registerHost instantiates the `solvapay_host` module exporting transport_send.
func registerHost(ctx context.Context, wz wazero.Runtime) error {
	_, err := wz.NewHostModuleBuilder("solvapay_host").
		NewFunctionBuilder().
		WithFunc(transportSend).
		Export("transport_send").
		Instantiate(ctx)
	return err
}

// transportSend reads a JSON request from the calling instance's memory,
// performs it with net/http, and writes the JSON response back into the same
// instance (allocated via its sv_alloc export). Returns a packed (ptr<<32)|len
// handle, or 0 on any failure (the guest maps 0 to a transport SdkError).
func transportSend(ctx context.Context, m api.Module, reqPtr, reqLen uint32) uint64 {
	raw, ok := m.Memory().Read(reqPtr, reqLen)
	if !ok {
		return 0
	}
	// Copy: the guest frees this buffer itself after the call returns.
	reqJSON := make([]byte, len(raw))
	copy(reqJSON, raw)

	respJSON, err := performRequest(ctx, reqJSON)
	if err != nil {
		return 0
	}

	alloc := m.ExportedFunction("sv_alloc")
	if alloc == nil {
		return 0
	}
	res, err := alloc.Call(ctx, uint64(len(respJSON)))
	if err != nil || len(res) == 0 {
		return 0
	}
	ptr := uint32(res[0])
	if !m.Memory().Write(ptr, respJSON) {
		return 0
	}
	return (uint64(ptr) << 32) | uint64(len(respJSON))
}

// performRequest executes one wireRequest and returns the marshalled response.
func performRequest(ctx context.Context, reqJSON []byte) ([]byte, error) {
	var wire wireRequest
	if err := json.Unmarshal(reqJSON, &wire); err != nil {
		return nil, err
	}

	var body io.Reader
	if wire.Body != nil {
		body = bytes.NewReader([]byte(*wire.Body))
	}
	req, err := http.NewRequestWithContext(ctx, wire.Method, wire.URL, body)
	if err != nil {
		return nil, err
	}
	for _, pair := range wire.Headers {
		req.Header.Set(pair[0], pair[1])
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return json.Marshal(wireResponse{
		Status: uint16(resp.StatusCode),
		Body:   string(payload),
	})
}
