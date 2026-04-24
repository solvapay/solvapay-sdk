import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import * as fetchExports from '../../packages/fetch/src/index'

const FUNCTIONS_DIR = join(__dirname, 'supabase/functions')

const EXPECTED_FUNCTIONS = [
  'activate-plan',
  'cancel-renewal',
  'check-purchase',
  'create-checkout-session',
  'create-customer-session',
  'create-payment-intent',
  'create-topup-payment-intent',
  'customer-balance',
  'get-merchant',
  'get-payment-method',
  'get-product',
  'list-plans',
  'process-payment',
  'reactivate-renewal',
  'solvapay-webhook',
  'sync-customer',
  'track-usage',
]

describe('supabase-edge example', () => {
  it('has an Edge Function directory per supported handler', () => {
    const dirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()

    expect(dirs).toEqual([...EXPECTED_FUNCTIONS].sort())
  })

  it('each function imports a valid export from @solvapay/fetch', () => {
    const exportedNames = Object.keys(fetchExports)

    for (const fn of EXPECTED_FUNCTIONS) {
      const indexPath = join(FUNCTIONS_DIR, fn, 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      const match = content.match(/import\s*\{\s*(\w+)\s*\}\s*from\s*['"]@solvapay\/fetch['"]/)
      expect(match, `${fn}/index.ts should import from @solvapay/fetch`).toBeTruthy()

      const importedName = match![1]
      expect(
        exportedNames,
        `${fn}/index.ts imports '${importedName}' which is not exported by @solvapay/fetch`,
      ).toContain(importedName)
    }
  })

  it('each function calls Deno.serve with the imported handler', () => {
    for (const fn of EXPECTED_FUNCTIONS) {
      const indexPath = join(FUNCTIONS_DIR, fn, 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      const importMatch = content.match(
        /import\s*\{\s*(\w+)\s*\}\s*from\s*['"]@solvapay\/fetch['"]/,
      )
      const handlerName = importMatch![1]

      // Accept either the direct shape `Deno.serve(handler)` or the
      // config-wrapper shape `Deno.serve(handler({...}))` used by the
      // webhook handler which takes a secret + onEvent callback.
      const directMatch = content.includes(`Deno.serve(${handlerName})`)
      const wrappedMatch = content.includes(`Deno.serve(${handlerName}(`)

      expect(
        directMatch || wrappedMatch,
        `${fn}/index.ts should call Deno.serve(${handlerName}) or Deno.serve(${handlerName}({...}))`,
      ).toBe(true)
    }
  })

  it('deno.json exists with required import mappings', () => {
    const denoJsonPath = join(FUNCTIONS_DIR, 'deno.json')
    const denoJson = JSON.parse(readFileSync(denoJsonPath, 'utf-8'))

    expect(denoJson.imports).toBeDefined()
    expect(denoJson.imports['@solvapay/fetch']).toBe('npm:@solvapay/fetch')
    expect(denoJson.imports['@solvapay/server']).toBe('npm:@solvapay/server')
    expect(denoJson.imports['@solvapay/auth']).toBe('npm:@solvapay/auth')
    expect(denoJson.imports['@solvapay/core']).toBe('npm:@solvapay/core')
  })
})
