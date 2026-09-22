import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

const s = createSolvaPay({
  apiClient: createSolvaPayClient({
    apiKey: process.env.SOLVAPAY_SECRET_KEY,
    apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
  }),
})

console.log('getPlatformConfig type:', typeof s.apiClient.getPlatformConfig)
if (s.apiClient.getPlatformConfig) {
  const r = await s.apiClient.getPlatformConfig()
  console.log('result:', JSON.stringify(r))
} else {
  console.log('MISSING — apiClient keys:', Object.keys(s.apiClient))
}
