import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import * as supabaseExports from '../../packages/supabase/src/index'

const FUNCTIONS_DIR = join(__dirname, 'supabase/functions')

const EXPECTED_FUNCTIONS = [
  'check-purchase',
  'create-payment-intent',
  'process-payment',
  'list-plans',
  'activate-plan',
  'track-usage',
  'customer-balance',
  'cancel-renewal',
  'reactivate-renewal',
  'create-topup-payment-intent',
]

describe('supabase-edge example', () => {
  it('has all 10 Edge Function directories', () => {
    const dirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()

    expect(dirs).toEqual(EXPECTED_FUNCTIONS.sort())
  })

  it('each function imports a valid export from @solvapay/supabase', () => {
    const exportedNames = Object.keys(supabaseExports)

    for (const fn of EXPECTED_FUNCTIONS) {
      const indexPath = join(FUNCTIONS_DIR, fn, 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      // Extract the imported name from: import { handlerName } from '@solvapay/supabase'
      const match = content.match(/import\s*\{\s*(\w+)\s*\}\s*from\s*['"]@solvapay\/supabase['"]/)
      expect(match, `${fn}/index.ts should import from @solvapay/supabase`).toBeTruthy()

      const importedName = match![1]
      expect(
        exportedNames,
        `${fn}/index.ts imports '${importedName}' which is not exported by @solvapay/supabase`,
      ).toContain(importedName)
    }
  })

  it('each function calls Deno.serve with the imported handler', () => {
    for (const fn of EXPECTED_FUNCTIONS) {
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
