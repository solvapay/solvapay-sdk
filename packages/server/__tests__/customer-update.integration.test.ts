import { describe, it, expect, beforeAll } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src/index'
import type { SolvaPayClient } from '../src/types'

/**
 * Customer Update & externalRef Backfill — Integration Tests
 *
 * Regression coverage for the 404 → 409 → 404 "customer lookup loop" that
 * any email-keyed integrator (Supabase Auth, Clerk, Auth0, …) hit on every
 * paywall call when the backend had a customer by email but no externalRef.
 *
 * These tests run independently of the main `backend.integration.test.ts`
 * suite — they only need an API client and don't create any product or plan
 * fixtures, so they stay green even when the test provider's currency
 * doesn't match what the shared suite expects.
 *
 * Prereqs (same as backend.integration.test.ts):
 *   USE_REAL_BACKEND=true
 *   SOLVAPAY_SECRET_KEY=<valid provider key>
 *   SOLVAPAY_API_BASE_URL=http://localhost:3001  (optional, defaults to api.solvapay.com)
 */

const USE_REAL_BACKEND = process.env.USE_REAL_BACKEND === 'true'
const SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY
const SOLVAPAY_API_BASE_URL = process.env.SOLVAPAY_API_BASE_URL

const describeIntegration =
  USE_REAL_BACKEND && SOLVAPAY_SECRET_KEY ? describe : describe.skip

describeIntegration('Customer Update & externalRef Backfill — Real Backend', () => {
  let apiClient: SolvaPayClient

  beforeAll(() => {
    apiClient = createSolvaPayClient({
      apiKey: SOLVAPAY_SECRET_KEY!,
      apiBaseUrl: SOLVAPAY_API_BASE_URL,
    })
  })

  const uniqueEmail = (tag: string) =>
    `sdk-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@auto-created.local`
  const uniqueExternalRef = (tag: string) =>
    `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  describe('apiClient.updateCustomer — PATCH /v1/sdk/customers/:ref', () => {
    it('backfills externalRef on a customer that was created without one', async () => {
      const email = uniqueEmail('patch-extref')
      const { customerRef: createdRef } = await apiClient.createCustomer!({
        email,
        metadata: {},
      })
      expect(createdRef).toBeDefined()

      const externalRef = uniqueExternalRef('ext')
      const updated = await apiClient.updateCustomer!(createdRef, { externalRef })
      expect(updated.customerRef).toBe(createdRef)

      const byExternalRef = await apiClient.getCustomer({ externalRef })
      expect(byExternalRef.customerRef).toBe(createdRef)
      expect(byExternalRef.externalRef).toBe(externalRef)
      expect(byExternalRef.email).toBe(email)
    })

    it('patches name and metadata without clearing externalRef', async () => {
      const email = uniqueEmail('patch-name')
      const externalRef = uniqueExternalRef('ext')
      const { customerRef: createdRef } = await apiClient.createCustomer!({
        email,
        externalRef,
        metadata: { source: 'sdk-integration-test' },
      })
      expect(createdRef).toBeDefined()

      const updated = await apiClient.updateCustomer!(createdRef, {
        name: 'Renamed Via SDK',
        metadata: { source: 'sdk-integration-test', renamed: true },
      })
      expect(updated.customerRef).toBe(createdRef)

      const resolved = await apiClient.getCustomer({ customerRef: createdRef })
      expect(resolved.externalRef).toBe(externalRef)
      expect(resolved.name).toBe('Renamed Via SDK')
    })
  })

  describe('paywall.ensureCustomer — full backfill flow', () => {
    it('resolves a stale email-only customer and leaves them discoverable by externalRef', async () => {
      // Seed the real-world shape: integrator created the customer by email
      // before externalRef was in the SDK's create path. Without the fix,
      // every subsequent ensureCustomer call hits 404 → 409 → 404 forever.
      const email = uniqueEmail('stale')
      const { customerRef: staleRef } = await apiClient.createCustomer!({
        email,
        metadata: {},
      })
      expect(staleRef).toBeDefined()

      const pre = await apiClient.getCustomer({ customerRef: staleRef })
      expect(pre.externalRef).toBeFalsy()

      const externalRef = uniqueExternalRef('supabase_user')
      const solvaPay = createSolvaPay({ apiClient })
      const resolved = await solvaPay.ensureCustomer(externalRef, externalRef, {
        email,
        name: 'Stale Loop User',
      })

      expect(resolved).toBe(staleRef)

      // The fix: whether the backend linked on POST (PR #102 behavior) or the
      // SDK backfilled via PATCH, the customer MUST now be resolvable by the
      // externalRef so the next lookup takes the fast path.
      const byExternalRef = await apiClient.getCustomer({ externalRef })
      expect(byExternalRef.customerRef).toBe(staleRef)
      expect(byExternalRef.externalRef).toBe(externalRef)
    })

    it('is idempotent across fresh SolvaPay instances — no duplicate customers', async () => {
      const email = uniqueEmail('idempotent')
      const externalRef = uniqueExternalRef('supabase_user')

      const firstRef = await createSolvaPay({ apiClient }).ensureCustomer(
        externalRef,
        externalRef,
        { email },
      )
      expect(firstRef).toBeDefined()

      // A second API-route instance resolves the same customer.
      const secondRef = await createSolvaPay({ apiClient }).ensureCustomer(
        externalRef,
        externalRef,
        { email },
      )
      expect(secondRef).toBe(firstRef)

      // A third call with only the externalRef (no email hint) still resolves
      // — proving the fast getCustomer({externalRef}) path works.
      const thirdRef = await createSolvaPay({ apiClient }).ensureCustomer(
        externalRef,
        externalRef,
      )
      expect(thirdRef).toBe(firstRef)
    })
  })
})

if (!USE_REAL_BACKEND || !SOLVAPAY_SECRET_KEY) {
  describe.skip('Customer Update & externalRef Backfill — SKIPPED (Configuration Required)', () => {
    it('shows setup instructions', () => {
      console.log('\n📋 To run this integration test:')
      console.log('   1. Set USE_REAL_BACKEND=true')
      console.log('   2. Set SOLVAPAY_SECRET_KEY=<valid sandbox key>')
      console.log('   3. (optional) Set SOLVAPAY_API_BASE_URL=http://localhost:3001')
      console.log('   4. Run: pnpm exec vitest run __tests__/customer-update.integration.test.ts\n')
    })
  })
}
