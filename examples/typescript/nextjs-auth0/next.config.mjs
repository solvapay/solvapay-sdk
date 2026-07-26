import { withSolvaPayNextConfig } from '@solvapay/examples-shared/solvapay-next-config'

/** @type {import('next').NextConfig} */
const nextConfig = withSolvaPayNextConfig(
  {
    transpilePackages: ['@solvapay/auth', '@solvapay/react', '@solvapay/core'],
  },
  { importMetaUrl: import.meta.url },
)

export default nextConfig
