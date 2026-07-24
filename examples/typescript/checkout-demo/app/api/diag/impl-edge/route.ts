import { NextResponse } from 'next/server'
import { ready, wasmVersion } from '@solvapay/server-wasm'

export const runtime = 'edge'

/**
 * Positive confirmation that the edge (WASM) Rust core is loaded under workerd.
 * Edge has no silent TS fallback when SOLVAPAY_IMPL=rust.
 */
export async function GET() {
  await ready()
  return NextResponse.json({
    runtime: 'edge',
    wasmVersion: wasmVersion(),
  })
}
