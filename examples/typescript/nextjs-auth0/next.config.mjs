import { withSolvaPayNextConfig } from '@solvapay/examples-shared/solvapay-next-config'

/** @type {import('next').NextConfig} */
const nextConfig = withSolvaPayNextConfig(
  {
    transpilePackages: ['@solvapay/auth', '@solvapay/react', '@solvapay/core'],
    webpack: config => {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        {
          module: /@auth0\/nextjs-auth0/,
          message: /Critical dependency: the request of a dependency is an expression/,
        },
      ]
      return config
    },
  },
  { importMetaUrl: import.meta.url },
)

export default nextConfig
