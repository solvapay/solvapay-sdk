// Runs reconciliation once (build plan §7m, decision 13): reports Opper's
// usage per decision to SolvaPay for every account in the clone's store, or
// for one user, and rotates a key SolvaPay flags. Prints one line per user;
// exits 1 when any user failed.
// Usage: pnpm reconcile [userRef]
import 'dotenv/config'
import { join } from 'node:path'
import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayAgentClient } from '../src/agent-layer/client'
import { loadConfig } from '../src/config'
import { importEncryptionKey } from '../src/lib/crypto'
import { FileKvStore } from '../src/lib/kv-store'
import { consoleLogger } from '../src/log'
import { OpperAccounts } from '../src/merchant/opper-accounts'
import { OpperClient } from '../src/merchant/opper-client'
import { createReconciler } from '../src/merchant/reconciler'

const [userRef] = process.argv.slice(2)

const config = loadConfig()
const store = new FileKvStore(join(config.dataDir, 'kv.json'))
const reconciler = createReconciler({
  accounts: new OpperAccounts(
    new OpperClient(config.opperBaseUrl, config.opperManagementKey),
    store,
    await importEncryptionKey(config.keyEncryptionKey),
  ),
  store,
  solvaPay: createSolvaPay({
    apiKey: config.solvapaySecretKey,
    apiBaseUrl: config.solvapayApiBaseUrl,
  }),
  agentClient: createSolvaPayAgentClient({
    apiBaseUrl: config.solvapayApiBaseUrl,
    secretKey: config.solvapaySecretKey,
  }),
  log: consoleLogger,
})

const run = await reconciler.runOnce(userRef)
process.stdout.write(`window ${run.window.from} to ${run.window.to}\n`)
for (const outcome of run.outcomes) {
  if (outcome.status !== 'reported') {
    process.stdout.write(`${JSON.stringify(outcome)}\n`)
    continue
  }
  const { unmatched, ...summary } = outcome
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  for (const call of unmatched) process.stdout.write(`  ${JSON.stringify(call)}\n`)
}
if (run.outcomes.length === 0) process.stdout.write('No accounts\n')
process.exit(run.outcomes.some(outcome => outcome.status === 'failed') ? 1 : 0)
