/**
 * Which identity source this demo runs on.
 *
 * `supabase` is the integration the demo documents: a real session, its JWT
 * verified in `proxy.ts`, and the Supabase user id used as the SolvaPay
 * customer ref.
 *
 * `anonymous` exists so the demo can run against a local platform with no
 * Supabase project. The browser mints a customer ref, sends it as
 * `x-customer-ref`, and `proxy.ts` promotes it to the `x-user-id` header
 * every SolvaPay route helper reads. Nothing about SolvaPay's own
 * configuration is optional in either mode.
 *
 * Set `NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH` to choose explicitly; with it unset the
 * mode follows whether Supabase credentials are present.
 */

export type DemoAuthMode = 'supabase' | 'anonymous'

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

function resolveDemoAuthMode(): DemoAuthMode {
  const explicit = process.env.NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH?.trim()

  if (explicit === 'anonymous') return 'anonymous'
  if (explicit === 'supabase') {
    if (!supabaseConfigured) {
      throw new Error(
        'NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH=supabase requires NEXT_PUBLIC_SUPABASE_URL and ' +
          'NEXT_PUBLIC_SUPABASE_ANON_KEY to be set.',
      )
    }
    return 'supabase'
  }
  if (explicit) {
    throw new Error(
      `NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH must be "supabase" or "anonymous", got "${explicit}".`,
    )
  }

  return supabaseConfigured ? 'supabase' : 'anonymous'
}

export const demoAuthMode = resolveDemoAuthMode()
