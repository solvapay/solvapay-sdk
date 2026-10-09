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
  dataDir: string
}

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
    dataDir: fileURLToPath(new URL('../data/', import.meta.url)),
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}
