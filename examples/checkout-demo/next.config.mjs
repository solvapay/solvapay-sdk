import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/** @type {import('next').NextConfig} */
/* global process */
const nextConfig = {
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
