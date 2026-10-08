import 'dotenv/config'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
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
  merchantKeys: merchantKeysFrom(entries),
  accounts: new OpperAccounts(
    new OpperClient(config.opperBaseUrl, config.opperManagementKey),
    new FileKvStore(join(config.dataDir, 'kv.json')),
    await importEncryptionKey(config.keyEncryptionKey),
  ),
  upstream: createOpperUpstream({ baseUrl: config.opperBaseUrl }),
  log: consoleLogger,
})

serve({ fetch: app.fetch, port: config.port }, info => {
  consoleLogger.info('clone.listening', {
    port: info.port,
    merchantKeys: entries.length,
    anthropicBaseUrl: `http://localhost:${info.port}/v3/compat`,
  })
})
