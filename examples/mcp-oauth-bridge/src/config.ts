import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

export const paywallEnabled = process.env.PAYWALL_ENABLED !== 'false'
export const port = parseInt(process.env.MCP_PORT || '3004', 10)
// Bind to 0.0.0.0 so webhook POSTs to 127.0.0.1 reach the server (IPv4 loopback).
export const host = process.env.MCP_HOST || '0.0.0.0'
export const mcpPublicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || `http://localhost:${port}`
export const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3000'
export const solvapayProductRef = process.env.SOLVAPAY_PRODUCT_REF || ''
export const solvapayWebhookSecret = process.env.SOLVAPAY_WEBHOOK_SECRET || ''

export const solvaPay = paywallEnabled
  ? createSolvaPay({
      apiClient: createSolvaPayClient({
        apiKey: process.env.SOLVAPAY_SECRET_KEY!,
        apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
      }),
    })
  : null

export const payable = solvaPay?.payable({ product: solvapayProductRef }) ?? null
