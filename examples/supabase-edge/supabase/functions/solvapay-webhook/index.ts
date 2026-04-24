import { solvapayWebhook } from '@solvapay/fetch'

Deno.serve(solvapayWebhook({
  secret: Deno.env.get('SOLVAPAY_WEBHOOK_SECRET')!,
  onEvent: async event => {
    // eslint-disable-next-line no-console
    console.log(`Received webhook: ${event.type}`, event)
  },
}))
