import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@solvapay/auth',
    '@solvapay/react',
    '@solvapay/server',
    '@solvapay/core',
    '@solvapay/next',
    '@solvapay/react-supabase',
  ],
}

export default nextConfig

initOpenNextCloudflareForDev()
