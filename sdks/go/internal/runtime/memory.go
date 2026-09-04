package runtime

import (
	"context"
	"encoding/json"
	"fmt"
)

// call writes argsJSON into the guest, invokes fn(ptr, len), and returns the
// resulting envelope string (the guest owns/free the args buffer; the host
// reads and frees the result buffer).
func (in *instance) call(ctx context.Context, fn, argsJSON string) (string, error) {
	ptr, length, err := in.writeArgs(ctx, argsJSON)
	if err != nil {
		return "", err
	}
	export := in.mod.ExportedFunction(fn)
	if export == nil {
		return "", fmt.Errorf("solvapay: guest export %q not found", fn)
	}
	res, err := export.Call(ctx, uint64(ptr), uint64(length))
	if err != nil {
		return "", fmt.Errorf("solvapay: call %s: %w", fn, err)
	}
	return in.readPacked(ctx, res[0])
}

// callNoArgs invokes a zero-argument export (e.g. sv_version) and reads its
// packed string result.
func (in *instance) callNoArgs(ctx context.Context, fn string) (string, error) {
	export := in.mod.ExportedFunction(fn)
	if export == nil {
		return "", fmt.Errorf("solvapay: guest export %q not found", fn)
	}
	res, err := export.Call(ctx)
	if err != nil {
		return "", fmt.Errorf("solvapay: call %s: %w", fn, err)
	}
	return in.readPacked(ctx, res[0])
}

// writeArgs allocates a guest buffer via sv_alloc and copies argsJSON into it.
func (in *instance) writeArgs(ctx context.Context, argsJSON string) (uint32, uint32, error) {
	data := []byte(argsJSON)
	length := uint32(len(data))
	if length == 0 {
		// sv_alloc(0) returns a dangling non-null pointer; the guest tolerates it.
		return 0, 0, nil
	}
	alloc := in.mod.ExportedFunction("sv_alloc")
	if alloc == nil {
		return 0, 0, fmt.Errorf("solvapay: guest export \"sv_alloc\" not found")
	}
	res, err := alloc.Call(ctx, uint64(length))
	if err != nil {
		return 0, 0, fmt.Errorf("solvapay: sv_alloc: %w", err)
	}
	ptr := uint32(res[0])
	if !in.mod.Memory().Write(ptr, data) {
		return 0, 0, fmt.Errorf("solvapay: failed to write %d args bytes", length)
	}
	return ptr, length, nil
}

// readPacked reads a (ptr<<32)|len string from guest memory and frees it.
func (in *instance) readPacked(ctx context.Context, packed uint64) (string, error) {
	if packed == 0 {
		return "", nil
	}
	ptr := uint32(packed >> 32)
	length := uint32(packed & 0xFFFFFFFF)
	buf, ok := in.mod.Memory().Read(ptr, length)
	if !ok {
		return "", fmt.Errorf("solvapay: failed to read %d result bytes", length)
	}
	out := string(buf) // copy before freeing the underlying memory
	if dealloc := in.mod.ExportedFunction("sv_dealloc"); dealloc != nil {
		_, _ = dealloc.Call(ctx, uint64(ptr), uint64(length))
	}
	return out, nil
}

// clientConfigJSON builds the sv_client_new args payload.
func clientConfigJSON(apiKey, baseURL string) string {
	payload := map[string]any{"apiKey": apiKey}
	if baseURL != "" {
		payload["apiBaseUrl"] = baseURL
	}
	data, _ := json.Marshal(payload)
	return string(data)
}

// envelopeConfigError returns an error if a sv_client_new envelope is a failure.
func envelopeConfigError(envelope string) error {
	if envelope == "" {
		return nil
	}
	var env struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal([]byte(envelope), &env); err != nil {
		return fmt.Errorf("solvapay: decode sv_client_new envelope: %w", err)
	}
	if !env.OK {
		return fmt.Errorf("solvapay: sv_client_new failed: %s", envelope)
	}
	return nil
}
