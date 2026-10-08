import { afterEach, describe, expect, it } from 'vitest'
import { startCardPageServer, type CardPageServer } from '../../scripts/card-page-server'

const config = {
  publishableKey: 'pk_test_123',
  stripeAccountId: 'acct_1UOMqJBM93LBsMCx',
  clientSecret: 'seti_1_secret_abc',
  merchant: 'prov_W3TLPNOA</script><script>alert(1)</script>',
}

let server: CardPageServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('card page server', () => {
  it('serves the page on 127.0.0.1 with the config embedded and script-safe', async () => {
    server = await startCardPageServer(config, 0)
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)

    const html = await (await fetch(server.url)).text()
    expect(html).toContain('https://js.stripe.com/v3/')
    expect(html).toContain('"stripeAccountId":"acct_1UOMqJBM93LBsMCx"')
    expect(html).toContain('"clientSecret":"seti_1_secret_abc"')
    expect(html).not.toContain('CARD_PAGE_CONFIG')
    expect(html).not.toContain('</script><script>alert(1)')
  })

  it('resolves when the page reports the SetupIntent', async () => {
    server = await startCardPageServer(config, 0)

    const response = await fetch(`${server.url}done`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupIntentId: 'seti_1', status: 'succeeded' }),
    })

    expect(response.status).toBe(204)
    await expect(server.done).resolves.toEqual({ setupIntentId: 'seti_1', status: 'succeeded' })
  })

  it('refuses a report that is not a SetupIntent, and unknown paths', async () => {
    server = await startCardPageServer(config, 0)

    const bad = await fetch(`${server.url}done`, {
      method: 'POST',
      body: JSON.stringify({ setupIntentId: 'pi_1', status: 'succeeded' }),
    })
    expect(bad.status).toBe(400)
    expect((await fetch(`${server.url}other`)).status).toBe(404)
  })
})
