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

  it('reads usage with the user key', async () => {
    const { opper, accounts } = await setup()
    await accounts.open('alice')
    const row = {
      timeBucket: '2026-10-10T00:00:00Z',
      cost: '0.01',
      groups: { decision_id: 'dec_A' },
    }
    opper.usage.set('op-secret-1', [row])
    const query = { groupBy: ['decision_id'], granularity: 'month' as const }
    expect(await accounts.readUsage('alice', query)).toEqual([row])
    expect(opper.usageQueries).toEqual([query])
  })

  it('lists the users with an account and reads a user project', async () => {
    const { accounts, store } = await setup()
    await accounts.open('bob')
    await accounts.open('alice')
    await store.put('reconcile:alice', '{}')
    expect(await accounts.userRefs()).toEqual(['alice', 'bob'])
    expect(await accounts.projectUuid('alice')).toBe('uuid-sp-alice')
    await expect(accounts.projectUuid('carol')).rejects.toThrow('No Opper account for carol')
  })

  it('rotates: mints a new key, stores it, then revokes the old one', async () => {
    const { opper, store, accounts } = await setup()
    await accounts.open('alice')
    opper.calls.length = 0
    let storedWhenRevoked: string | null = null
    const deleteKey = opper.deleteKey.bind(opper)
    opper.deleteKey = async (projectUuid, id) => {
      storedWhenRevoked = await store.get('account:alice')
      return deleteKey(projectUuid, id)
    }

    expect(await accounts.rotate('alice')).toEqual({ oldKeyId: 1, newKeyId: 2 })
    expect(opper.calls).toEqual([
      expect.stringMatching(/^mintKey alice:key:[0-9a-f-]{36}$/),
      'deleteKey 1',
    ])
    expect(storedWhenRevoked).toBe(await store.get('account:alice'))
    expect([...opper.keys.keys()]).toEqual([2])
    expect((await accounts.open('alice')).runtimeKey).toBe('op-secret-2')
    expect(await accounts.projectUuid('alice')).toBe('uuid-sp-alice')
  })

  it('keeps the old key stored when the mint fails', async () => {
    const { opper, accounts } = await setup()
    await accounts.open('alice')
    opper.mintKey = async () => {
      throw new Error('Opper down')
    }
    await expect(accounts.rotate('alice')).rejects.toThrow('Opper down')
    expect((await accounts.open('alice')).runtimeKey).toBe('op-secret-1')
    expect(opper.keys.has(1)).toBe(true)
  })
})
