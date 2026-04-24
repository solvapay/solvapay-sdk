import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import * as supabaseExports from '../../packages/supabase/src/index'

const FUNCTIONS_DIR = join(__dirname, 'supabase/functions')

const EXPECTED_HANDLER_FUNCTIONS = [
  'activate-plan',
  'cancel-renewal',
  'check-purchase',
  'create-checkout-session',
  'create-customer-session',
  'create-payment-intent',
  'create-topup-payment-intent',
  'customer-balance',
  'list-plans',
  'process-payment',
  'reactivate-renewal',
  'sync-customer',
  'track-usage',
]

describe('supabase-edge example', () => {
  it('has all 14 Edge Function directories (13 handlers + webhook)', () => {
    const dirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()

    expect(dirs).toEqual([...EXPECTED_HANDLER_FUNCTIONS, 'solvapay-webhook'].sort())
  })

  it('each handler function imports a valid export from @solvapay/supabase', () => {
    const exportedNames = Object.keys(supabaseExports)

    for (const fn of EXPECTED_HANDLER_FUNCTIONS) {
      const indexPath = join(FUNCTIONS_DIR, fn, 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      const match = content.match(/import\s*\{\s*(\w+)\s*\}\s*from\s*['"]@solvapay\/supabase['"]/)
      expect(match, `${fn}/index.ts should import from @solvapay/supabase`).toBeTruthy()

      const importedName = match![1]
      expect(
        exportedNames,
        `${fn}/index.ts imports '${importedName}' which is not exported by @solvapay/supabase`,
      ).toContain(importedName)
    }
  })

  it('each handler function calls Deno.serve with the imported handler', () => {
    for (const fn of EXPECTED_HANDLER_FUNCTIONS) {
      const indexPath = join(FUNCTIONS_DIR, fn, 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      const importMatch = content.match(
        /import\s*\{\s*(\w+)\s*\}\s*from\s*['"]@solvapay\/supabase['"]/,
      )
      const handlerName = importMatch![1]

      expect(
        content,
        `${fn}/index.ts should call Deno.serve(${handlerName})`,
      ).toContain(`Deno.serve(${handlerName})`)
    }
  })

  it('webhook function imports solvapayWebhook and calls Deno.serve', () => {
    const indexPath = join(FUNCTIONS_DIR, 'solvapay-webhook', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    expect(content).toContain("import { solvapayWebhook } from '@solvapay/supabase'")
    expect(content).toContain('Deno.serve(')
    expect(content).toContain('solvapayWebhook(')
    expect(content).toContain('onEvent')
  })

  it('deno.json exists with required import mappings', () => {
    const denoJsonPath = join(FUNCTIONS_DIR, 'deno.json')
    const denoJson = JSON.parse(readFileSync(denoJsonPath, 'utf-8'))

    expect(denoJson.imports).toBeDefined()
    expect(denoJson.imports['@solvapay/supabase']).toBe('npm:@solvapay/supabase')
    expect(denoJson.imports['@solvapay/server']).toBe('npm:@solvapay/server')
    expect(denoJson.imports['@solvapay/auth']).toBe('npm:@solvapay/auth')
    expect(denoJson.imports['@solvapay/core']).toBe('npm:@solvapay/core')
  })
})
