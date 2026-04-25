/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@solvapay/auth',
    '@solvapay/core',
    '@solvapay/examples-shared',
    '@solvapay/next',
    '@solvapay/react',
    '@solvapay/server',
  ],
}

export default nextConfig
