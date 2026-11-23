import type { WebhookEvent } from '@solvapay/server'
import { solvapayWebhook } from '@solvapay/server/fetch'

Deno.serve(
  solvapayWebhook({
    secret: Deno.env.get('SOLVAPAY_WEBHOOK_SECRET')!,
    onEvent: async (event: WebhookEvent) => {
      // Customer events carry `externalRef`, and purchase events
      // `customerExternalRef`: the user id you passed when the customer was
      // created (here, the Supabase user id from `sync-customer`). Use it to find
      // your own record. It is null when the customer is not linked to a user yet.
      if (event.type === 'customer.created' || event.type === 'customer.updated') {
        const { reference, externalRef } = event.data.object
        // eslint-disable-next-line no-console
        console.log(`${event.type}: ${reference} is user ${externalRef ?? '(not linked yet)'}`)
        return
      }

      if (event.type.startsWith('purchase.')) {
        // Purchase payloads are not typed by the SDK yet; these fields are on every purchase event.
        const { reference, customerExternalRef } = event.data.object as {
          reference: string
          customerExternalRef: string | null
        }
        // eslint-disable-next-line no-console
        console.log(
          `${event.type}: purchase ${reference} for user ${customerExternalRef ?? '(not linked yet)'}`,
        )
        return
      }

      // eslint-disable-next-line no-console
      console.log(`Received webhook: ${event.type}`, event)
    },
  }),
)
