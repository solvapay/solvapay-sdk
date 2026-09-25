/**
 * NOTE ON THE FILENAME: this should be `CardFields.stability.test.tsx`. It
 * started life as a scratch file and the session that wrote it could not
 * rename or delete files in this folder. The contents are real; rename it.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { installMockVault, mockCaptureSession } from '@solvapay/test-utils'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { CardFields } from './CardFields'
import { resetVaultScriptLoaderForTests } from '../vault/loadVaultScript'

/**
 * Render stability for the vault capture surface.
 *
 * These guard a specific and nasty class of bug rather than any feature. The
 * capture surface publishes state on every keystroke, and each publish
 * re-renders. So anything in the tree that depends on an identity which
 * changes per render — a config object, an inline callback, a composed ref —
 * becomes a feedback loop: publish, new identity, remount the vault field,
 * publish again.
 *
 * Three separate instances of that shipped before there was a mock capable of
 * mounting a field at all:
 *
 *   1. the form-creation effect depended on the `script` object, which a host
 *      writes inline;
 *   2. the field slot's ref callback depended on the context object;
 *   3. the composed ref was rebuilt inline on every render, which undid (2)
 *      even after `attach` itself was made stable.
 *
 * In a browser each one destroys and recreates a cross-origin iframe while
 * somebody is typing their card number into it. Under test they exhaust the
 * heap. Neither failure names its cause, which is why these assertions count
 * things instead of checking behaviour.
 */

const adapter = {
  getToken: vi.fn().mockResolvedValue('t'),
  getUserId: vi.fn().mockResolvedValue('u'),
}

interface Counts {
  publishes: number
  fields: number
  forms: number
  mints: number
}

async function mountAndCount(
  children: React.ReactNode,
  /** Passed inline on purpose: that is how a host will write it. */
  script: { version: string } = { version: '2.20.0' },
): Promise<Counts> {
  resetVaultScriptLoaderForTests()
  const vault = installMockVault()

  let publishes = 0
  let mints = 0
  const session = mockCaptureSession()

  try {
    render(
      <SolvaPayProvider
        config={
          {
            auth: { adapter },
            transport: {
              createCaptureSession: () => {
                mints += 1
                return Promise.resolve(session)
              },
              createInstrument: vi.fn(),
            },
          } as never
        }
      >
        <CardFields.Root
          script={script}
          onStateChange={() => {
            publishes += 1
          }}
        >
          {children}
        </CardFields.Root>
      </SolvaPayProvider>,
    )

    await new Promise(resolve => setTimeout(resolve, 400))

    return { publishes, fields: vault.fields.length, forms: vault.created.length, mints }
  } finally {
    vault.uninstall()
    resetVaultScriptLoaderForTests()
  }
}

describe('CardFields render stability', () => {
  it('mounts each vault field exactly once', async () => {
    const counts = await mountAndCount(
      <>
        <CardFields.Number />
        <CardFields.Expiry />
        <CardFields.Cvc />
      </>,
    )

    // Three slots, three `field()` calls. More than three means the ref is
    // detaching and reattaching, which in a browser means the iframe is being
    // rebuilt under the cardholder.
    expect(counts.fields).toBe(3)
  })

  it('creates one form and mints one grant, with the script passed inline', async () => {
    const counts = await mountAndCount(<CardFields.Number />)

    expect(counts.forms).toBe(1)
    expect(counts.mints).toBe(1)
  })

  it('settles rather than publishing without bound', async () => {
    const counts = await mountAndCount(
      <>
        <CardFields.Number />
        <CardFields.Expiry />
        <CardFields.Cvc />
      </>,
    )

    // One publish per field mount is the honest steady state. The bound is
    // loose on purpose: the point is that it terminates, not the exact number.
    expect(counts.publishes).toBeGreaterThan(0)
    expect(counts.publishes).toBeLessThanOrEqual(6)
  })

  it('does not rebuild the form when the parent re-renders', async () => {
    resetVaultScriptLoaderForTests()
    const vault = installMockVault()
    const session = mockCaptureSession()

    const Harness = ({ tick }: { tick: number }) => (
      <SolvaPayProvider
        config={
          {
            auth: { adapter },
            transport: {
              createCaptureSession: () => Promise.resolve(session),
              createInstrument: vi.fn(),
            },
          } as never
        }
      >
        {/* Both inline, as a host would write them. */}
        <CardFields.Root script={{ version: '2.20.0' }} onStateChange={() => {}}>
          <CardFields.Number />
        </CardFields.Root>
        <span>{tick}</span>
      </SolvaPayProvider>
    )

    const view = render(<Harness tick={0} />)
    await new Promise(resolve => setTimeout(resolve, 300))
    const formsAfterMount = vault.created.length
    const fieldsAfterMount = vault.fields.length

    for (let tick = 1; tick <= 5; tick += 1) {
      view.rerender(<Harness tick={tick} />)
    }
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(vault.created.length).toBe(formsAfterMount)
    expect(vault.fields.length).toBe(fieldsAfterMount)

    vault.uninstall()
    resetVaultScriptLoaderForTests()
  })
})
