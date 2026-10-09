import { fileURLToPath } from 'node:url'

export interface CloneConfig {
  port: number
  opperBaseUrl: string
  opperManagementKey: string
  keyEncryptionKey: string
  /** SolvaPay agent token issuer; the JWKS is fetched from `agentJwksUrl`. */
  agentIssuer: string
  agentJwksUrl: string
  /** This merchant's SolvaPay provider reference: the `aud` agent tokens must carry. */
  providerRef: string
  /** SolvaPay API, with this merchant's secret key and the product agent calls are billed to. */
  solvapayApiBaseUrl: string
  solvapaySecretKey: string
  productRef: string
  /** The most one call is expected to cost (USD); a call is allowed while the balance covers it. */
  estimateUsd: string
  dataDir: string
}

/** Until mandates set a per-call cap (S5), one fixed estimate gates every call. */
const DEFAULT_ESTIMATE_USD = '0.50'

/** Reads the clone's settings. Missing values fail at start, never default silently. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CloneConfig {
  const port = Number(required(env, 'PORT'))
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer')
  return {
    port,
    opperBaseUrl: required(env, 'OPPER_BASE_URL').replace(/\/+$/, ''),
    opperManagementKey: required(env, 'OPPER_MANAGEMENT_KEY'),
    keyEncryptionKey: required(env, 'CLONE_KEY_ENCRYPTION_KEY'),
    agentIssuer: required(env, 'SOLVAPAY_AGENT_ISSUER'),
    agentJwksUrl: required(env, 'SOLVAPAY_AGENT_JWKS_URL'),
    providerRef: required(env, 'SOLVAPAY_PROVIDER_REF'),
    solvapayApiBaseUrl: required(env, 'SOLVAPAY_API_BASE_URL').replace(/\/+$/, ''),
    solvapaySecretKey: required(env, 'SOLVAPAY_SECRET_KEY'),
    productRef: required(env, 'SOLVAPAY_PRODUCT_REF'),
    estimateUsd: usdAmount(env.CLONE_ESTIMATE_USD?.trim() || DEFAULT_ESTIMATE_USD),
    dataDir: fileURLToPath(new URL('../data/', import.meta.url)),
  }
}

function usdAmount(value: string): string {
  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new Error(`CLONE_ESTIMATE_USD must be a USD amount with up to 8 decimals, got "${value}"`)
  }
  return value
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}
