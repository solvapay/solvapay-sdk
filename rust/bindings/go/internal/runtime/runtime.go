// Package runtime hosts the wazero machinery behind the public solvapay API:
// it compiles the embedded WASI guest once, keeps a demand-grown bounded pool
// of instances, marshals the guest-memory ABI, and services the guest's
// net/http host transport import.
package runtime

import (
	"context"
	"fmt"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

// Config controls how a Runtime instantiates guest modules.
type Config struct {
	// APIKey, when non-empty, is applied to every new instance via sv_client_new.
	APIKey string
	// BaseURL overrides the SolvaPay origin (empty keeps the guest default).
	BaseURL string
	// MaxInstances bounds the pool; values < 1 default to 1.
	MaxInstances int
}

// Runtime owns a compiled guest module and its instance pool.
type Runtime struct {
	wz       wazero.Runtime
	compiled wazero.CompiledModule
	pool     *pool
}

// New compiles wasm, registers the host transport, and prepares the pool.
func New(ctx context.Context, wasm []byte, cfg Config) (*Runtime, error) {
	if cfg.MaxInstances < 1 {
		cfg.MaxInstances = 1
	}

	wz := wazero.NewRuntime(ctx)
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, wz); err != nil {
		_ = wz.Close(ctx)
		return nil, fmt.Errorf("solvapay: instantiate wasi: %w", err)
	}
	if err := registerHost(ctx, wz); err != nil {
		_ = wz.Close(ctx)
		return nil, err
	}

	compiled, err := wz.CompileModule(ctx, wasm)
	if err != nil {
		_ = wz.Close(ctx)
		return nil, fmt.Errorf("solvapay: compile guest: %w", err)
	}

	rt := &Runtime{wz: wz, compiled: compiled}
	rt.pool = newPool(cfg.MaxInstances, func(ctx context.Context) (*instance, error) {
		return rt.instantiate(ctx, cfg)
	})
	return rt, nil
}

// Close tears down the pool and the underlying wazero runtime.
func (rt *Runtime) Close(ctx context.Context) error {
	rt.pool.closeAll(ctx)
	return rt.wz.Close(ctx)
}

// Version calls the guest sv_version export (no client needed).
func (rt *Runtime) Version(ctx context.Context) (string, error) {
	inst, err := rt.pool.borrow(ctx)
	if err != nil {
		return "", err
	}
	out, callErr := inst.callNoArgs(ctx, "sv_version")
	rt.finish(ctx, inst, ctx.Err(), callErr)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return out, callErr
}

// CallEnvelope borrows an instance, invokes fn with the JSON args, and returns
// the raw envelope string. On ctx cancellation the instance is discarded rather
// than returned to the pool.
func (rt *Runtime) CallEnvelope(ctx context.Context, fn, argsJSON string) (string, error) {
	inst, err := rt.pool.borrow(ctx)
	if err != nil {
		return "", err
	}
	out, callErr := inst.call(ctx, fn, argsJSON)
	rt.finish(ctx, inst, ctx.Err(), callErr)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return out, callErr
}

// finish returns a clean instance to the pool, or discards a dirty / cancelled one.
func (rt *Runtime) finish(ctx context.Context, inst *instance, ctxErr, callErr error) {
	if ctxErr != nil || callErr != nil {
		rt.pool.discard(ctx, inst)
		return
	}
	rt.pool.release(inst)
}

// instantiate spins up a fresh guest instance and optionally configures its client.
func (rt *Runtime) instantiate(ctx context.Context, cfg Config) (*instance, error) {
	// Anonymous name (empty) so multiple instances can coexist in the pool.
	mod, err := rt.wz.InstantiateModule(ctx, rt.compiled, wazero.NewModuleConfig().WithName(""))
	if err != nil {
		return nil, fmt.Errorf("solvapay: instantiate guest: %w", err)
	}
	inst := &instance{mod: mod}
	if cfg.APIKey != "" {
		args := clientConfigJSON(cfg.APIKey, cfg.BaseURL)
		if out, callErr := inst.call(ctx, "sv_client_new", args); callErr != nil {
			_ = mod.Close(ctx)
			return nil, callErr
		} else if err := envelopeConfigError(out); err != nil {
			_ = mod.Close(ctx)
			return nil, err
		}
	}
	return inst, nil
}

// instance is a single guest module instance plus cached exports.
type instance struct {
	mod api.Module
}

func (in *instance) close(ctx context.Context) {
	_ = in.mod.Close(ctx)
}
