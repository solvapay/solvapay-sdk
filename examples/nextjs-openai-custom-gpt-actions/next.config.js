/** @type {import('next').NextConfig} */
const enableStandaloneOutput = process.env.NEXT_STANDALONE_OUTPUT === "1"
const nextConfig = {
  serverExternalPackages: ['@solvapay/server'],
  // Configure src directory as the default
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  // Enable standalone output for Docker/Cloud Run deployments
  ...(enableStandaloneOutput ? { output: "standalone" } : {}),
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
