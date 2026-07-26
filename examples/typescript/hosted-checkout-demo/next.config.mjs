import { withSolvaPayNextConfig } from '@solvapay/examples-shared/solvapay-next-config'

/** @type {import('next').NextConfig} */
const nextConfig = withSolvaPayNextConfig(
  {
    transpilePackages: ['@solvapay/react', '@solvapay/core', '@solvapay/react-supabase'],
  },
  { importMetaUrl: import.meta.url },
)

export default nextConfig
