import { describe, expect, it } from 'vitest'
import * as edgeEntry from '../src/edge'
import * as helpers from '../src/helpers'

// Regression guard: @solvapay/fetch (and any other edge-runtime adapter) imports
// all *Core route helpers from the default `@solvapay/server` entry. Node resolves
// that to `dist/index.js`, but Deno/edge-light/worker resolve it to `dist/edge.js`.
// If `edge.ts` forgets to re-export a helper, adapters crash at boot with
// `does not provide an export named 'fooCore'`. This test keeps the two surfaces
// in sync for route helpers.
describe('edge entry point parity', () => {
  it('re-exports every *Core route helper from ./helpers', () => {
    const coreHelperNames = Object.keys(helpers).filter(name => name.endsWith('Core'))

    expect(coreHelperNames.length).toBeGreaterThan(0)

    const edgeExports = new Set(Object.keys(edgeEntry))
    const missing = coreHelperNames.filter(name => !edgeExports.has(name))

    expect(missing).toEqual([])
  })

  it('re-exports isErrorResult and handleRouteError from ./helpers', () => {
    expect(edgeEntry).toHaveProperty('isErrorResult')
    expect(edgeEntry).toHaveProperty('handleRouteError')
  })
})
