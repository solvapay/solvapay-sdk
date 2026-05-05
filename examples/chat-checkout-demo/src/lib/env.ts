/**
 * Vite exposes env vars prefixed with `VITE_` to the browser. This helper
 * provides typed access with a clear error when something is missing.
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
  geminiApiKey: readEnv('VITE_GEMINI_API_KEY', false),
  subscription: { productRef: readEnv('VITE_SUBSCRIPTION_PRODUCT_REF', false) },
  daypass: { productRef: readEnv('VITE_DAYPASS_PRODUCT_REF', false) },
  topup: { productRef: readEnv('VITE_TOPUP_PRODUCT_REF', false) },
}
