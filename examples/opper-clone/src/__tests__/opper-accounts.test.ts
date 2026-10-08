import { describe, expect, it } from 'vitest'
import { importEncryptionKey } from '../lib/crypto'
import { MemoryKvStore } from '../lib/kv-store'
import { OpperAccounts } from '../merchant/opper-accounts'
import { FakeOpperManagement, TEST_ENCRYPTION_KEY } from './fakes'

async function setup() {
  const opper = new FakeOpperManagement()
  const store = new MemoryKvStore()
  const accounts = new OpperAccounts(opper, store, await importEncryptionKey(TEST_ENCRYPTION_KEY))
  return { opper, store, accounts }
}

describe('OpperAccounts', () => {
  it('creates project sp-<userRef> and one key on first open', async () => {
    const { opper, accounts } = await setup()
    const account = await accounts.open('alice')
    expect(account.projectName).toBe('sp-alice')
    expect(account.runtimeKey).toBe('op-secret-1')
    expect(opper.calls).toEqual(['createProject sp-alice', 'mintKey alice:key:1'])
  })

  it('stores the key encrypted and reuses it without calling Opper', async () => {
    const { opper, store, accounts } = await setup()
    await accounts.open('alice')
    const raw = await store.get('account:alice')
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('op-secret-1')

    opper.calls.length = 0
    expect((await accounts.open('alice')).runtimeKey).toBe('op-secret-1')
    expect(opper.calls).toEqual([])
  })

  it('opens once when two first calls race', async () => {
    const { opper, accounts } = await setup()
    const [a, b] = await Promise.all([accounts.open('alice'), accounts.open('alice')])
    expect(a.runtimeKey).toBe(b.runtimeKey)
    expect(opper.calls.filter(call => call.startsWith('mintKey'))).toHaveLength(1)
  })

  it('replaces a key Opper replays without its secret', async () => {
    const { opper, accounts } = await setup()
    opper.preMint('alice:key:1')
    const account = await accounts.open('alice')
    expect(opper.calls).toContain('deleteKey 1')
    expect(account.runtimeKey).toBe('op-secret-2')
  })

  it('reads spend with the user key and revokes it on close', async () => {
    const { opper, store, accounts } = await setup()
    await accounts.open('alice')
    expect((await accounts.readSpend('alice')).spentCents).toBe(12)

    await accounts.close('alice')
    expect(opper.keys.size).toBe(0)
    expect(opper.projects.has('sp-alice')).toBe(true)
    expect(await store.get('account:alice')).toBeNull()
  })
})
