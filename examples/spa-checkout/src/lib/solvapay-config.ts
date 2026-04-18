import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const EDGE = `${SUPABASE_URL}/functions/v1`

export function createSolvaPayConfig() {
  return {
    auth: {
      adapter: createSupabaseAuthAdapter({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
      }),
    },
    api: {
      checkPurchase: `${EDGE}/check-purchase`,
      createPayment: `${EDGE}/create-payment-intent`,
      processPayment: `${EDGE}/process-payment`,
      createTopupPayment: `${EDGE}/create-topup-payment-intent`,
      customerBalance: `${EDGE}/customer-balance`,
      cancelRenewal: `${EDGE}/cancel-renewal`,
      reactivateRenewal: `${EDGE}/reactivate-renewal`,
      activatePlan: `${EDGE}/activate-plan`,
      listPlans: `${EDGE}/list-plans`,
      getMerchant: `${EDGE}/get-merchant`,
      getProduct: `${EDGE}/get-product`,
    },
  }
}
