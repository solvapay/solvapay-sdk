/* global process */
import { withSolvaPayNextConfig } from '@solvapay/examples-shared/solvapay-next-config'

/** @type {import('next').NextConfig} */
const checkoutDemoNgrokHost = process.env.CHECKOUT_DEMO_NGROK_HOST

const nextConfig = withSolvaPayNextConfig(
  {
    ...(checkoutDemoNgrokHost ? { allowedDevOrigins: [checkoutDemoNgrokHost] } : {}),
    transpilePackages: [
      '@solvapay/auth',
      '@solvapay/react',
      '@solvapay/core',
      '@solvapay/react-supabase',
    ],
    env: {
      NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF:
        process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF ??
        process.env.NEXT_PUBLIC_PRODUCT_REF ??
        process.env.SOLVAPAY_PRODUCT_REF,
    },
    // Plan docs use /api/_diag/*; Next private folders can't serve `_diag`, so rewrite.
    async rewrites() {
      return [{ source: '/api/_diag/:path*', destination: '/api/diag/:path*' }]
    },
  },
  { importMetaUrl: import.meta.url },
)

export default nextConfig

// OpenNext Cloudflare-for-dev patches Next into a workerd-like environment that
// cannot load napi `.node` addons. Keep it opt-in; `preview:cf` / deploy use the
// OpenNext build pipeline separately and do not need this for local Node/napi.
if (process.env.OPEN_NEXT_CLOUDFLARE_DEV === '1') {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare')
  initOpenNextCloudflareForDev()
}
