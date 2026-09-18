/**
 * PARKED, NOT YET RUNNING. See the skip below.
 *
 * These are the tests the vault capture surface needs: that `save()` captures
 * and records, that it never captures when it has nowhere to report the
 * result, that a rejected card records nothing, that the grant is re-minted
 * because it is spent, and that the tokenization stays pinned to what the
 * outbound route expects.
 *
 * They do not run yet. The suite exhausts the heap before the first test body
 * executes — vitest reports `tests 0ms` and a render counter placed inside the
 * tree never fires even once, so whatever spins does so during mount, not
 * during the assertions.
 *
 * Diagnosing it turned up two real defects, both fixed and committed
 * separately, and neither of them was the cause:
 *
 *   1. `useCaptureSession` re-minted on any unusable session, so an expired
 *      grant produced an unbounded mint loop against the endpoint that hands
 *      out write credentials.
 *   2. The field slot's ref callback depended on the context object, which is
 *      new on every state publish. React therefore detached and reattached the
 *      ref on each keystroke, remounting the vault iframe and losing what had
 *      been typed into it.
 *
 * The remaining suspect is the harness rather than the component: every other
 * `SolvaPayProvider` test in this package installs a `fetch` spy before
 * rendering, and this one does not, so the provider's own fetches may be
 * retrying without bound. That is a hypothesis, not a finding.
 *
 * Next step: add the `fetch` spy the sibling provider tests use, then remove
 * the skip. Do not remove the skip before the suite is green — an
 * out-of-memory crash in CI is worse than a missing test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import React from 'react'
import {
  installMockVault,
  mockCaptureSession,
  MOCK_VAULT_FIELD_NAMES as F,
  type MockVault,
  type MockVaultOptions,
} from '@solvapay/test-utils'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { CardFields } from './CardFields'
import { useCardFields, type CardFieldsContextValue } from '../components/CardFieldsContext'
import { resetVaultScriptLoaderForTests } from '../vault/loadVaultScript'

const SCRIPT = { version: '2.20.0' }

const mockAdapter = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  getUserId: vi.fn().mockResolvedValue('user-123'),
}

let vault: MockVault | null = null

interface SetupOptions {
  vault?: MockVaultOptions
  createCaptureSession?: ReturnType<typeof vi.fn>
  createCredential?: ReturnType<typeof vi.fn>
  omitCreateCredential?: boolean
  children?: React.ReactNode
}

function setup(opts: SetupOptions = {}) {
  const mock = installMockVault(opts.vault)
  vault = mock

  const createCaptureSession =
    opts.createCaptureSession ?? vi.fn().mockResolvedValue(mockCaptureSession())
  const createCredential =
    opts.createCredential ?? vi.fn().mockResolvedValue({ credentialRef: 'cred_1', existing: false })

  const transport = {
    createCaptureSession,
    ...(opts.omitCreateCredential ? {} : { createCredential }),
  }

  const probe: { current: CardFieldsContextValue | null } = { current: null }
  const Probe = () => {
    // Test-only escape hatch: hand the context back to the test so it can call
    // save() directly, without a button. react-hooks/immutability is right
    // that a component should not write to an outer value; this one exists
    // only to observe, renders nothing, and is confined to this file.
    // eslint-disable-next-line react-hooks/immutability
    probe.current = useCardFields()
    return null
  }

  const children = opts.children ?? (
    <>
      <CardFields.Number />
      <CardFields.Expiry />
      <CardFields.Cvc />
    </>
  )

  const view = render(
    <SolvaPayProvider config={{ auth: { adapter: mockAdapter }, transport } as never}>
      <CardFields.Root script={SCRIPT}>
        {children}
        <Probe />
      </CardFields.Root>
    </SolvaPayProvider>,
  )

  return {
    view,
    vault: mock,
    createCaptureSession,
    createCredential,
    ctx: () => {
      if (!probe.current) throw new Error('CardFields context was never published')
      return probe.current
    },
  }
}

/** Ready means the script, the session and every field are all up. */
async function waitForReady(ctx: () => CardFieldsContextValue) {
  await waitFor(() => expect(ctx().ready).toBe(true))
}

describe.skip('CardFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetVaultScriptLoaderForTests()
  })

  afterEach(() => {
    vault?.uninstall()
    vault = null
    resetVaultScriptLoaderForTests()
  })

  describe('mounting', () => {
    it('mints a capture session and creates the form against its tenant', async () => {
      const { createCaptureSession, vault: v, ctx } = setup()
      await waitForReady(ctx)

      expect(createCaptureSession).toHaveBeenCalledTimes(1)
      expect(v.created).toEqual([{ tenantId: 'tnt_mock', environment: 'sandbox' }])
    })

    it('mounts one vault field per slot, and no others', async () => {
      const { vault: v, ctx } = setup()
      await waitForReady(ctx)

      expect(v.fields.map(f => f.options.name).sort()).toEqual(
        [F.cardNumber, F.expiry, F.cvc].sort(),
      )
    })

    it('renders the vault input inside the slot we own', async () => {
      const { ctx, view } = setup()
      await waitForReady(ctx)

      const slot = view.container.querySelector('[data-solvapay-card-fields-number]')
      expect(slot?.querySelector('[data-mock-vault-field]')).toBeTruthy()
    })

    it('pins the tokenization the outbound route expects', async () => {
      // Not cosmetic. A volatile/persistent mismatch makes the reveal forward
      // the alias upstream as if it were a card number.
      const { vault: v, ctx } = setup()
      await waitForReady(ctx)

      expect(v.fields.find(f => f.options.name === F.cardNumber)?.options.tokenization).toEqual({
        format: 'FPE_SIX_T_FOUR',
        storage: 'PERSISTENT',
      })
      expect(v.fields.find(f => f.options.name === F.cvc)?.options.tokenization).toEqual({
        format: 'NUM_LENGTH_PRESERVING',
        storage: 'VOLATILE',
      })
    })

    it('surfaces the brand and last four the vault reports', async () => {
      const { ctx } = setup({ vault: { card: { brand: 'MASTERCARD', last4: '4444' } } })
      await waitForReady(ctx)

      await waitFor(() => {
        expect(ctx().state.brand).toBe('mastercard')
        expect(ctx().state.last4).toBe('4444')
      })
    })
  })

  describe('save', () => {
    it('captures the card and records the credential', async () => {
      const { ctx, createCredential } = setup()
      await waitForReady(ctx)

      let result: { credentialRef: string; existing: boolean } | undefined
      await act(async () => {
        result = await ctx().save()
      })

      expect(result).toEqual({ credentialRef: 'cred_1', existing: false })
      expect(createCredential).toHaveBeenCalledTimes(1)
    })

    it('presents the capture grant token to the vault', async () => {
      const { ctx, vault: v } = setup()
      await waitForReady(ctx)
      await act(async () => {
        await ctx().save()
      })

      expect(v.createCardCalls).toHaveLength(1)
      expect(v.createCardCalls[0].auth).toBe('mock-vault-write-token')
    })

    it('reports the credential under the grant it was captured with', async () => {
      const { ctx, createCredential } = setup()
      await waitForReady(ctx)
      await act(async () => {
        await ctx().save()
      })

      expect(createCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'card_mock000000000001',
          captureSessionId: 'cap_mock00000000000000000000000000',
        }),
      )
    })

    it('sends descriptors and nothing that could be card data', async () => {
      const { ctx, createCredential } = setup()
      await waitForReady(ctx)
      await act(async () => {
        await ctx().save()
      })

      const sent = createCredential.mock.calls[0][0]
      expect(Object.keys(sent.descriptors).sort()).toEqual([
        'brand',
        'expMonth',
        'expYear',
        'funding',
        'issuerCountry',
        'last4',
      ])
      // Four trailing digits is the longest run of card digits allowed out.
      expect(JSON.stringify(sent.descriptors)).not.toMatch(/[0-9]{5,}/)
    })

    it('passes an already-stored card through as existing', async () => {
      const { ctx } = setup({
        createCredential: vi.fn().mockResolvedValue({ credentialRef: 'cred_old', existing: true }),
      })
      await waitForReady(ctx)

      let result: { credentialRef: string; existing: boolean } | undefined
      await act(async () => {
        result = await ctx().save()
      })

      expect(result).toEqual({ credentialRef: 'cred_old', existing: true })
    })

    it('forwards setAsDefault when asked', async () => {
      const { ctx, createCredential } = setup()
      await waitForReady(ctx)
      await act(async () => {
        await ctx().save({ setAsDefault: true })
      })

      expect(createCredential).toHaveBeenCalledWith(expect.objectContaining({ setAsDefault: true }))
    })

    it('re-mints the grant afterwards, because it is spent once used', async () => {
      const { ctx, createCaptureSession } = setup()
      await waitForReady(ctx)
      expect(createCaptureSession).toHaveBeenCalledTimes(1)

      await act(async () => {
        await ctx().save()
      })

      await waitFor(() => expect(createCaptureSession).toHaveBeenCalledTimes(2))
    })

    it('does not send the card when a field is invalid', async () => {
      const { ctx, vault: v, createCredential } = setup()
      await waitForReady(ctx)

      act(() => {
        v.invalidate(F.cvc, 'Wrong length')
      })
      await waitFor(() => expect(ctx().complete).toBe(false))

      await expect(ctx().save()).rejects.toMatchObject({ code: 'incomplete' })
      expect(v.createCardCalls).toHaveLength(0)
      expect(createCredential).not.toHaveBeenCalled()
    })

    it('does not record anything when the vault rejects the card', async () => {
      const { ctx, createCredential } = setup({
        vault: { failCreateCard: { status: 402, message: 'Card declined' } },
      })
      await waitForReady(ctx)

      await expect(ctx().save()).rejects.toMatchObject({ code: 'rejected' })
      expect(createCredential).not.toHaveBeenCalled()
    })

    it('maps a vault outage to a vault error rather than a card rejection', async () => {
      const { ctx } = setup({ vault: { failCreateCard: { status: 503 } } })
      await waitForReady(ctx)

      await expect(ctx().save()).rejects.toMatchObject({ code: 'vault_error' })
    })

    it('publishes the error on the context so the UI can show it', async () => {
      const { ctx } = setup({
        vault: { failCreateCard: { status: 402, message: 'Card declined' } },
      })
      await waitForReady(ctx)

      await expect(ctx().save()).rejects.toThrow()
      await waitFor(() => expect(ctx().error?.code).toBe('rejected'))
    })

    it('refuses to send the card at all when the transport cannot record it', async () => {
      // Capturing with nowhere to report the result leaves a card in the vault
      // that we hold no reference to, which nobody can ever charge.
      const { ctx, vault: v } = setup({ omitCreateCredential: true })
      await waitForReady(ctx)

      await expect(ctx().save()).rejects.toThrow(/createCredential/)
      expect(v.createCardCalls).toHaveLength(0)
    })

    it('refuses to save on an expired grant, without calling the vault', async () => {
      const { ctx, vault: v } = setup({
        createCaptureSession: vi
          .fn()
          .mockResolvedValue(mockCaptureSession({ expiresAt: Date.now() - 1000 })),
      })
      await waitFor(() => expect(v.created.length).toBeGreaterThan(0))

      await expect(ctx().save()).rejects.toMatchObject({ code: 'session_expired' })
      expect(v.createCardCalls).toHaveLength(0)
    })
  })

  describe('typing', () => {
    it('tracks validity from what the cardholder types', async () => {
      const { ctx, vault: v } = setup({ vault: { startValid: false } })
      await waitFor(() => expect(v.fields.length).toBe(3))

      expect(ctx().complete).toBe(false)

      act(() => {
        v.type(F.cardNumber, '4242424242424242')
        v.type(F.expiry, '12/30')
        v.type(F.cvc, '123')
      })

      await waitFor(() => expect(ctx().complete).toBe(true))
    })
  })

  describe('field errors', () => {
    it('renders the message the vault gave for that field', async () => {
      const { ctx, vault: v } = setup({
        children: (
          <>
            <CardFields.Cvc />
            <CardFields.FieldError name="cvc" />
          </>
        ),
      })
      await waitFor(() => expect(v.fields.length).toBe(1))

      act(() => {
        v.invalidate(F.cvc, 'Wrong length')
      })

      await waitFor(() => expect(screen.getByText('Wrong length')).toBeTruthy())
      expect(ctx().state.fields.cvc.valid).toBe(false)
    })
  })
})
