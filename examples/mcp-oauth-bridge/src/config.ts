import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY || '',
  apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
})

export const solvaPay = createSolvaPay({
  apiClient,
})

export const payable = solvaPay.payable({
  product:
    process.env.SOLVAPAY_PRODUCT_REF || process.env.SOLVAPAY_PRODUCT || 'mcp-oauth-bridge-product',
})

export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || 'http://127.0.0.1:3004'
export const oauthBaseUrl = process.env.SOLVAPAY_OAUTH_BASE_URL || 'http://localhost:3000'
export const mcpServerId = process.env.MCP_SERVER_ID || ''
