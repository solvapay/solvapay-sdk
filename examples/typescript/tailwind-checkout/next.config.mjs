/* global process */
import { withSolvaPayNextConfig } from '@solvapay/examples-shared/solvapay-next-config'

/** @type {import('next').NextConfig} */
const nextConfig = withSolvaPayNextConfig(
  {
    transpilePackages: [
      '@solvapay/auth',
      '@solvapay/core',
      '@solvapay/examples-shared',
      '@solvapay/react',
    ],
    env: {
      NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF:
        process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF ??
        process.env.NEXT_PUBLIC_PRODUCT_REF ??
        process.env.SOLVAPAY_PRODUCT_REF,
    },
  },
  { importMetaUrl: import.meta.url },
)

export default nextConfig
