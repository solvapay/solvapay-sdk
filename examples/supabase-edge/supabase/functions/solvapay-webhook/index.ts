import type { WebhookEvent } from '@solvapay/server'
import { solvapayWebhook } from '@solvapay/server/fetch'

Deno.serve(
  solvapayWebhook({
    secret: Deno.env.get('SOLVAPAY_WEBHOOK_SECRET')!,
    onEvent: async (event: WebhookEvent) => {
      // eslint-disable-next-line no-console
      console.log(`Received webhook: ${event.type}`, event)
    },
  }),
)
