import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

export const paywallEnabled = process.env.PAYWALL_ENABLED !== 'false'
export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || 'http://localhost:3030'
export const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3010'
export const solvapayProductRef = process.env.SOLVAPAY_PRODUCT_REF || ''

export const solvaPay = paywallEnabled
  ? createSolvaPay({
      apiClient: createSolvaPayClient({
        apiKey: process.env.SOLVAPAY_SECRET_KEY!,
        apiBaseUrl: solvapayApiBaseUrl,
      }),
    })
  : null

export const payable = solvaPay?.payable({ product: solvapayProductRef }) ?? null
