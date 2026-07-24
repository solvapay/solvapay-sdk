import { NextResponse } from 'next/server'
import { ready, wasmVersion } from '@solvapay/server-wasm'

export const runtime = 'edge'

/** Positive confirmation that the edge (WASM) Rust core is loaded under workerd. */
export async function GET() {
  await ready()
  return NextResponse.json({
    impl: 'rust',
    runtime: 'edge',
    wasmVersion: wasmVersion(),
  })
}
