import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/fetch/handlers', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/fetch/handlers')>()
  const stub = (name: string) => vi.fn(async () => Response.json({ handledBy: name }))
  return Object.fromEntries(
    Object.keys(actual).map(name => [
      name,
      typeof actual[name as keyof typeof actual] === 'function'
        ? stub(name)
        : actual[name as keyof typeof actual],
    ]),
  )
})

import { solvapayRoutes } from '../../src/fetch/routes'

const call = (method: string, path: string) =>
  solvapayRoutes()(new Request(`https://app.test${path}`, { method }))

describe('solvapayRoutes', () => {
  it("sends each of React's default paths to its handler", async () => {
    expect(await (await call('GET', '/api/check-purchase')).json()).toEqual({
      handledBy: 'checkPurchase',
    })
    expect(await (await call('PUT', '/api/auto-recharge')).json()).toEqual({
      handledBy: 'saveAutoRecharge',
    })
    expect(await (await call('DELETE', '/api/auto-recharge')).json()).toEqual({
      handledBy: 'disableAutoRecharge',
    })
    expect(await (await call('GET', '/api/limits')).json()).toEqual({ handledBy: 'checkLimits' })
  })

  it('answers 404 for a path it does not serve', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404)
    expect((await call('GET', '/elsewhere/check-purchase')).status).toBe(404)
  })

  it('answers 405 with Allow for a known path and the wrong method', async () => {
    const response = await call('POST', '/api/auto-recharge')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, PUT, DELETE')
  })

  it('serves under a custom basePath', async () => {
    const routes = solvapayRoutes({ basePath: '/billing/' })
    const response = await routes(new Request('https://app.test/billing/merchant'))
    expect(await response.json()).toEqual({ handledBy: 'getMerchant' })
  })
})
