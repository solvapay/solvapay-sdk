import 'dotenv/config'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createSolvaPay } from '@solvapay/server'
import { createRemoteJWKSet } from 'jose'
import { createAgentLayer, createPolicy } from './agent-layer'
import { createSolvaPayAgentClient } from './agent-layer/client'
import { createMetering } from './agent-layer/metering'
import { createAgentTokenVerifier } from './agent-layer/identity/verify-agent-token'
import { createApp } from './app'
import { loadConfig } from './config'
import { importEncryptionKey } from './lib/crypto'
import { FileKvStore } from './lib/kv-store'
import { consoleLogger } from './log'
import { merchantKeysFrom, readMerchantKeyFile } from './merchant/merchant-keys'
import { OpperAccounts } from './merchant/opper-accounts'
import { OpperClient } from './merchant/opper-client'
import { createOpperUpstream } from './upstream/opper'

const config = loadConfig()
const entries = await readMerchantKeyFile(join(config.dataDir, 'merchant-keys.json'))
if (entries.length === 0) {
  consoleLogger.info('merchant_keys.none', { hint: 'pnpm merchant-key <userRef> <label>' })
}

const app = createApp({
  agentLayer: createAgentLayer({
    verifyAgentToken: createAgentTokenVerifier({
      issuer: config.agentIssuer,
      providerRef: config.providerRef,
      keys: createRemoteJWKSet(new URL(config.agentJwksUrl)),
    }),
  }),
  merchantKeys: merchantKeysFrom(entries),
  accounts: new OpperAccounts(
    new OpperClient(config.opperBaseUrl, config.opperManagementKey),
    new FileKvStore(join(config.dataDir, 'kv.json')),
    await importEncryptionKey(config.keyEncryptionKey),
  ),
  metering: createMetering({
    solvaPay: createSolvaPay({
      apiKey: config.solvapaySecretKey,
      apiBaseUrl: config.solvapayApiBaseUrl,
    }),
    productRef: config.productRef,
  }),
  policy: createPolicy({
    client: createSolvaPayAgentClient({
      apiBaseUrl: config.solvapayApiBaseUrl,
      secretKey: config.solvapaySecretKey,
    }),
  }),
  upstream: createOpperUpstream({ baseUrl: config.opperBaseUrl }),
  log: consoleLogger,
})

serve({ fetch: app.fetch, port: config.port }, info => {
  consoleLogger.info('clone.listening', {
    port: info.port,
    merchantKeys: entries.length,
    providerRef: config.providerRef,
    productRef: config.productRef,
    agentIssuer: config.agentIssuer,
    anthropicBaseUrl: `http://localhost:${info.port}/v3/compat`,
  })
})
