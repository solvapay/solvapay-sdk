import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/** @type {import('next').NextConfig} */
/* global process */
const checkoutDemoNgrokHost = process.env.CHECKOUT_DEMO_NGROK_HOST

const nextConfig = {
  ...(checkoutDemoNgrokHost ? { allowedDevOrigins: [checkoutDemoNgrokHost] } : {}),
  transpilePackages: [
    '@solvapay/auth',
    '@solvapay/react',
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/next',
    '@solvapay/react-supabase',
  ],
  env: {
    NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF:
      process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF ??
      process.env.NEXT_PUBLIC_PRODUCT_REF ??
      process.env.SOLVAPAY_PRODUCT_REF,
  },
}

export default nextConfig

initOpenNextCloudflareForDev()
