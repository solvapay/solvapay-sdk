/**
 * The entry edge runtimes resolve (`deno`, `workerd`, `worker`, `edge-light`,
 * and `@solvapay/server/edge`): `./edge` with the WASM binding loaded before
 * any importer runs.
 *
 * `./edge` alone starts the load and returns. A sync surface called at an
 * importer's top level, such as building an MCP handler before the first
 * request in a Deno function, would then run before the binding exists. The
 * top-level await here closes that gap. It lives in its own module because
 * `./fetch` bundles `./edge` into a CommonJS build, which cannot hold one.
 */
import { warmWasmReady } from './wasm'

await warmWasmReady()

export * from './edge'
