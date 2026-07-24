/**
 * `buildPaywallGate` — thin re-export over Rust sync dispatch
 * (`native-decisions` → napi on Node / WASM on edge). Rust-only after Step 53.
 *
 * @since 1.2.0
 */

export { buildPaywallGate } from './native-decisions'
