/**
 * Stub for `@solvapay/core/browser-wasm` under checkout-demo vitest.
 * Tests install napi via `vitest.setup.ts` instead of browser WASM.
 */
export function warmBrowserCoreWasm(): Promise<void> {
  return Promise.resolve()
}

export function whenBrowserCoreWasmReady(): Promise<void> {
  return Promise.resolve()
}

export function resetBrowserCoreWasmForTests(): void {}
