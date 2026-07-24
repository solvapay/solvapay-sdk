/**
 * Minimal Cloudflare Workers smoke for Step 38R.
 *
 * Proves the workerd `initSync` path end-to-end against the built edge entry:
 * - async `verifyWebhook` (WASM)
 * - sync `buildPaywallGate` / `paywallErrorToClientPayload` (`initSync`)
 * - one `@solvapay/core` pure fn via the edge install (`validateBusinessDetails`)
 * - one async client method (`getMerchant`) against a stub origin
 *
 * Run:
 *   npx wrangler dev --local --port 8787
 *   curl -s http://127.0.0.1:8787/smoke | jq .
 *
 * Prerequisites: `pnpm --filter @solvapay/server --filter @solvapay/core build`
 * and `cd rust/bindings/wasm && pnpm build:wasm`.
 */

import {
  verifyWebhook,
  buildPaywallGate,
  paywallErrorToClientPayload,
  createSolvaPayClient,
  PaywallError,
} from '../../../../../packages/server/dist/edge.js'
import { validateBusinessDetails } from '../../../../../packages/core/dist/index.js'

const FIXTURE_BODY = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_fixture_1',
  created: 1782864000,
  api_version: '2025-10-01',
  data: { object: { id: 'pur_fixture_1' }, previous_attributes: null },
  livemode: false,
  request: { id: null, idempotency_key: null },
})
const FIXTURE_SECRET = 'whsec_test_fixture_secret'
const FIXTURE_SIGNATURE =
  't=1782864000,v1=04834cba2241fe998a4fb5b8bb4632b2c2e18a3e330dba1905f62b365521ca82'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/smoke') {
      return new Response('not found', { status: 404 })
    }

    const RealDate = Date
    globalThis.Date = class extends RealDate {
      static now() {
        return 1_782_864_000 * 1000
      }
    }

    const event = await verifyWebhook({
      body: FIXTURE_BODY,
      signature: FIXTURE_SIGNATURE,
      secret: FIXTURE_SECRET,
    })

    const gate = buildPaywallGate('prod_smoke', {
      remaining: 0,
      withinLimits: false,
      plan: '',
      checkoutUrl: 'https://checkout.example/smoke',
    })
    const payload = paywallErrorToClientPayload(
      new PaywallError('Payment required', gate),
    )

    const business = validateBusinessDetails({
      isBusiness: true,
      businessName: 'Acme Ltd',
      country: 'GB',
      taxId: 'GB123456789',
    })

    const stub = 'https://api.solvapay.invalid'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const target = typeof input === 'string' ? input : input.url
      if (String(target).includes('/v1/sdk/merchant')) {
        return new Response(
          JSON.stringify({
            displayName: 'Smoke Co',
            legalName: 'Smoke Co Ltd',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      return originalFetch(input, init)
    }

    const client = createSolvaPayClient({
      apiKey: 'sp_test_smoke',
      apiBaseUrl: stub,
    })
    const merchant = await client.getMerchant()

    globalThis.fetch = originalFetch
    globalThis.Date = RealDate

    const body = {
      impl: 'rust',
      ok:
        event.id === 'evt_fixture_1' &&
        gate.kind === 'payment_required' &&
        business.success === true &&
        merchant?.displayName === 'Smoke Co',
      webhook: { type: event.type, id: event.id },
      gate: { kind: gate.kind, product: gate.product },
      payloadKind: payload?.kind ?? null,
      businessSuccess: business.success,
      merchantDisplayName: merchant?.displayName ?? null,
    }

    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': 'application/json' },
    })
  },
}
