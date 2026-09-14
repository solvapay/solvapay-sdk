import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/helpers/customer', () => ({
  syncCustomerCore: vi.fn(),
}))

import { syncCustomerCore } from '../src/helpers/customer'
import { createCaptureSessionCore, createCredentialCore } from '../src/helpers/vault'

const mockSyncCustomer = vi.mocked(syncCustomerCore)

const request = () => new Request('https://example.test/api/capture-session')

const grant = {
  token: 'vault-write-token',
  tenantId: 'tnt_sandbox',
  environment: 'sandbox' as const,
  expiresAt: 1789000000000,
  captureSessionId: 'cap_1',
}

describe('createCaptureSessionCore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mints a grant for the signed-in customer', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCaptureSession = vi.fn().mockResolvedValue(grant)

    const result = await createCaptureSessionCore(
      request(),
      {},
      { solvaPay: { createCaptureSession } as never },
    )

    expect(createCaptureSession).toHaveBeenCalledWith({ customerRef: 'cus_1' })
    expect(result).toEqual(grant)
  })

  it('takes the customer from the session, never from the body', async () => {
    mockSyncCustomer.mockResolvedValue('cus_mine')
    const createCaptureSession = vi.fn().mockResolvedValue(grant)

    await createCaptureSessionCore(
      request(),
      { customerRef: 'cus_someone_else' } as never,
      { solvaPay: { createCaptureSession } as never },
    )

    expect(createCaptureSession).toHaveBeenCalledWith({ customerRef: 'cus_mine' })
  })

  it('passes a checkout session id through when the caller has one', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCaptureSession = vi.fn().mockResolvedValue(grant)

    await createCaptureSessionCore(
      request(),
      { checkoutSessionId: 'sess_1' },
      { solvaPay: { createCaptureSession } as never },
    )

    expect(createCaptureSession).toHaveBeenCalledWith({
      customerRef: 'cus_1',
      checkoutSessionId: 'sess_1',
    })
  })

  it('does not mint when the customer cannot be resolved', async () => {
    const error = { error: 'Not authenticated', status: 401 }
    mockSyncCustomer.mockResolvedValue(error as never)
    const createCaptureSession = vi.fn()

    const result = await createCaptureSessionCore(
      request(),
      {},
      { solvaPay: { createCaptureSession } as never },
    )

    expect(createCaptureSession).not.toHaveBeenCalled()
    expect(result).toEqual(error)
  })

  it('reports a client that cannot do vault capture rather than throwing', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')

    const result = await createCaptureSessionCore(request(), {}, { solvaPay: {} as never })

    expect(result).toMatchObject({ status: 501 })
  })
})

describe('createCredentialCore', () => {
  beforeEach(() => vi.clearAllMocks())

  const body = {
    handle: 'card_1',
    captureSessionId: 'cap_1',
    descriptors: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  }

  it('records the credential against the signed-in customer', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCredential = vi.fn().mockResolvedValue({ credentialRef: 'cred_1', existing: false })

    const result = await createCredentialCore(request(), body, {
      solvaPay: { createCredential } as never,
    })

    expect(createCredential).toHaveBeenCalledWith({
      handle: 'card_1',
      captureSessionId: 'cap_1',
      customerRef: 'cus_1',
      descriptors: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
    })
    expect(result).toEqual({ credentialRef: 'cred_1', existing: false })
  })

  it('passes an already-stored card through as existing rather than as an error', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCredential = vi.fn().mockResolvedValue({ credentialRef: 'cred_old', existing: true })

    const result = await createCredentialCore(request(), body, {
      solvaPay: { createCredential } as never,
    })

    expect(result).toEqual({ credentialRef: 'cred_old', existing: true })
  })

  it('forwards named descriptor fields only, so nothing else can be smuggled through', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCredential = vi.fn().mockResolvedValue({ credentialRef: 'cred_1', existing: false })

    await createCredentialCore(
      request(),
      {
        ...body,
        descriptors: {
          ...body.descriptors,
          // None of these are fields we keep. A spread would have passed them on.
          bin: '424242',
          fingerprint: 'fp_1',
          panAlias: '4242424242424242',
          cardNumber: '4242424242424242',
        } as never,
      },
      { solvaPay: { createCredential } as never },
    )

    const sent = JSON.stringify(createCredential.mock.calls[0][0])
    expect(sent).not.toContain('424242')
    expect(sent).not.toContain('fp_1')
    expect(sent).not.toContain('4242424242424242')
  })

  it('requires a handle', async () => {
    const result = await createCredentialCore(request(), { captureSessionId: 'cap_1' } as never, {})
    expect(result).toMatchObject({ status: 400 })
  })

  it('requires a capture session id, since without it nothing ties the card to a grant', async () => {
    const result = await createCredentialCore(request(), { handle: 'card_1' } as never, {})
    expect(result).toMatchObject({ status: 400 })
  })

  it('does not record when the customer cannot be resolved', async () => {
    const error = { error: 'Not authenticated', status: 401 }
    mockSyncCustomer.mockResolvedValue(error as never)
    const createCredential = vi.fn()

    const result = await createCredentialCore(request(), body, {
      solvaPay: { createCredential } as never,
    })

    expect(createCredential).not.toHaveBeenCalled()
    expect(result).toEqual(error)
  })
})
