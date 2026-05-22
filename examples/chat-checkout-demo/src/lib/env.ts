/**
 * Vite exposes env vars prefixed with `VITE_` to the browser. This helper
 * provides typed access with a clear warning when something is missing.
 *
 * The Gemini API key is intentionally NOT exposed here — it lives on the
 * server side (`GEMINI_API_KEY`, no `VITE_` prefix) and is consumed only
 * by the `/api/chat` route handler in `src/server/chat.ts`.
 */
function readEnv(name: string, required = true): string {
  const value = import.meta.env[name] as string | undefined
  if (!value) {
    if (required) {
      console.warn(`[chat-checkout-demo] Missing env var: ${name}`)
    }
    return ''
  }
  return value
}

export const env = {
  subscription: { productRef: readEnv('VITE_SUBSCRIPTION_PRODUCT_REF', false) },
  lifetime: { productRef: readEnv('VITE_LIFETIME_PRODUCT_REF', false) },
  topup: { productRef: readEnv('VITE_TOPUP_PRODUCT_REF', false) },
}
