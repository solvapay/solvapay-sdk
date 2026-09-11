import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE_TEMPLATE_DIR, MCP_SHARED_SCRIPTS_DIR } from './scaffold'

const VERIFY_SCRIPTS = [
  path.join(MCP_SHARED_SCRIPTS_DIR, 'verify.mjs'),
  path.join(BASE_TEMPLATE_DIR, 'scripts', 'verify.mjs'),
]

describe('verify.mjs transport-tool callability', () => {
  for (const file of VERIFY_SCRIPTS) {
    it(`${path.basename(path.dirname(path.dirname(file)))} rejects -32601 for create_payment_intent`, async () => {
      const src = await readFile(file, 'utf8')
      expect(src).toContain('runTransportToolCallableCheck')
      expect(src).toContain("callTool(base, 'create_payment_intent', { purpose: 'topup' }")
      expect(src).toContain('-32601')
      expect(src).toContain('checks.transportToolCallable')
      expect(src).toMatch(/bearerToken[\s\S]*runTransportToolCallableCheck/)
    })
  }
})
