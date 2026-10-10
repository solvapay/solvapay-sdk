// Prints Opper's usage on a user's key, split by tag, from the clone's own
// account store. The key is decrypted in memory and never printed.
// Usage: pnpm opper-usage <userRef> [groupBy,…] [granularity] [fromDate] [toDate]
import 'dotenv/config'
import { join } from 'node:path'
import { loadConfig } from '../src/config'
import { importEncryptionKey } from '../src/lib/crypto'
import { FileKvStore } from '../src/lib/kv-store'
import { OpperAccounts } from '../src/merchant/opper-accounts'
import { OpperClient, type UsageQuery } from '../src/merchant/opper-client'

const GRANULARITIES = ['minute', 'hour', 'day', 'month', 'year'] as const

const [userRef, groupBy = 'decision_id', granularity = 'day', from, to] = process.argv.slice(2)
if (!userRef || !GRANULARITIES.includes(granularity as UsageQuery['granularity'])) {
  console.error(
    'Usage: pnpm opper-usage <userRef> [groupBy,…] [minute|hour|day|month|year] [fromDate] [toDate]',
  )
  process.exit(1)
}

const config = loadConfig()
const accounts = new OpperAccounts(
  new OpperClient(config.opperBaseUrl, config.opperManagementKey),
  new FileKvStore(join(config.dataDir, 'kv.json')),
  await importEncryptionKey(config.keyEncryptionKey),
)
const rows = await accounts.readUsage(userRef, {
  groupBy: groupBy.split(','),
  granularity: granularity as UsageQuery['granularity'],
  from,
  to,
})
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`)
process.stdout.write(`${rows.length} row(s)\n`)
