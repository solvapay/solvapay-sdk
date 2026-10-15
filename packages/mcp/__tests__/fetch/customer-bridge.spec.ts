/**
 * `bridgeVerifiedBearerToCustomer`: the one place an external identity
 * (Auth0 / Clerk / Supabase `sub`) becomes a SolvaPay `cus_` reference.
 * Also proves `createSolvaPayMcpFetch` wires it around a caller-supplied
 * `verifyToken`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SolvaPay } from '@solvapay/server'
import type { VerifiedBearer } from '@solvapay/mcp-core'
import {
  bridgeVerifiedBearerToCustomer,
  createSolvaPayMcpFetch,
} from '../../src/fetch/createSolvaPayMcpFetch'

const req = new Request('https://mcp.example.com/mcp', { method: 'POST' })

function makeSolvaPay(ensureCustomer = vi.fn(async () => 'cus_bridged')) {
  return {
    solvaPay: { ensureCustomer } as unknown as Pick<SolvaPay, 'ensureCustomer'>,
    ensureCustomer,
  }
}

function verifierReturning(result: VerifiedBearer | null) {
  return vi.fn(async (_token: string, _req: Request) => result)
}

describe('bridgeVerifiedBearerToCustomer', () => {
  it('passes null through without touching SolvaPay', async () => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(verifierReturning(null), solvaPay)
    expect(await bridged('tok', req)).toBeNull()
    expect(ensureCustomer).not.toHaveBeenCalled()
  })

  it('passes a cus_ subject through as customerRef without calling ensureCustomer', async () => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({ subject: 'cus_direct' }),
      solvaPay,
    )
    expect(await bridged('tok', req)).toEqual({ subject: 'cus_direct', customerRef: 'cus_direct' })
    expect(ensureCustomer).not.toHaveBeenCalled()
  })

  it('keeps a customerRef the verifier already resolved', async () => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({ subject: 'auth0|1', customerRef: 'cus_from_verifier' }),
      solvaPay,
    )
    expect(await bridged('tok', req)).toMatchObject({ customerRef: 'cus_from_verifier' })
    expect(ensureCustomer).not.toHaveBeenCalled()
  })

  it('resolves a non-cus_ subject via ensureCustomer(subject, subject, { email, name }) when the email is verified', async () => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({
        subject: 'google-oauth2|123',
        email: 'ada@example.com',
        emailVerified: true,
        name: 'Ada',
      }),
      solvaPay,
    )
    const result = await bridged('tok', req)
    expect(result).toMatchObject({ subject: 'google-oauth2|123', customerRef: 'cus_bridged' })
    expect(ensureCustomer).toHaveBeenCalledWith('google-oauth2|123', 'google-oauth2|123', {
      email: 'ada@example.com',
      name: 'Ada',
    })
  })

  it.each([
    ['false', false],
    ['absent', undefined],
  ])('drops the email when emailVerified is %s', async (_label, emailVerified) => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({
        subject: 'auth0|abc',
        email: 'victim@example.com',
        ...(emailVerified !== undefined ? { emailVerified } : {}),
        name: 'Mallory',
      }),
      solvaPay,
    )
    await bridged('tok', req)
    expect(ensureCustomer).toHaveBeenCalledWith('auth0|abc', 'auth0|abc', { name: 'Mallory' })
  })

  it('omits name when the verifier did not supply one', async () => {
    const { solvaPay, ensureCustomer } = makeSolvaPay()
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({ subject: 'auth0|abc' }),
      solvaPay,
    )
    await bridged('tok', req)
    expect(ensureCustomer).toHaveBeenCalledWith('auth0|abc', 'auth0|abc', {})
  })

  it('propagates ensureCustomer failures instead of masking them', async () => {
    const { solvaPay } = makeSolvaPay(
      vi.fn(async () => {
        throw new Error('SolvaPay API 503')
      }),
    )
    const bridged = bridgeVerifiedBearerToCustomer(
      verifierReturning({ subject: 'auth0|abc' }),
      solvaPay,
    )
    await expect(bridged('tok', req)).rejects.toThrow('SolvaPay API 503')
  })
})

describe('createSolvaPayMcpFetch wires the bridge around verifyToken', () => {
  const publicBaseUrl = 'https://mcp.example.com'

  it('calls ensureCustomer for an external subject and serves a bridged customer_ref', async () => {
    const ensureCustomer = vi.fn(async () => 'cus_bridged')
    const solvaPay = { ensureCustomer } as unknown as SolvaPay
    const verifyToken = vi.fn(async () => ({
      subject: 'auth0|abc',
      email: 'ada@example.com',
      emailVerified: true,
    }))

    const handler = createSolvaPayMcpFetch({
      solvaPay,
      productRef: 'prd_test',
      resourceUri: 'ui://test/app.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl,
      apiBaseUrl: 'https://api.solvapay.com',
      verifyToken,
      authorizationServer: {
        issuers: ['https://tenant.eu.auth0.com/'],
        scopesSupported: ['openid', 'profile', 'email', 'offline_access'],
      },
    })

    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer external-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(verifyToken).toHaveBeenCalledWith('external-token', expect.any(Request))
    expect(ensureCustomer).toHaveBeenCalledWith('auth0|abc', 'auth0|abc', {
      email: 'ada@example.com',
    })
  })

  it('rejects an unverifiable token with 401 invalid_token before any SolvaPay call', async () => {
    const ensureCustomer = vi.fn()
    const handler = createSolvaPayMcpFetch({
      solvaPay: { ensureCustomer } as unknown as SolvaPay,
      productRef: 'prd_test',
      resourceUri: 'ui://test/app.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl,
      apiBaseUrl: 'https://api.solvapay.com',
      verifyToken: async () => null,
      authorizationServer: {
        issuers: ['https://tenant.eu.auth0.com/'],
        scopesSupported: ['openid'],
      },
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer bad' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(ensureCustomer).not.toHaveBeenCalled()
  })
})
