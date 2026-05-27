/** @type {import('next').NextConfig} */
/* global process */
const nextConfig = {
  transpilePackages: [
    '@solvapay/auth',
    '@solvapay/core',
    '@solvapay/examples-shared',
    '@solvapay/next',
    '@solvapay/react',
    '@solvapay/server',
  ],
  env: {
    NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF: process.env.SOLVAPAY_PRODUCT_REF,
  },
}

export default nextConfig
