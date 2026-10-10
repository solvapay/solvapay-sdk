import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileKvStore, MemoryKvStore, type KvStore } from '../lib/kv-store'

describe('FileKvStore', () => {
  it('persists across instances, serialises writes and keeps the file private', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'opper-clone-')), 'kv.json')
    const store = new FileKvStore(path)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.put(`k${i}`, `v${i}`)))
    await store.delete('k0')

    const reopened = new FileKvStore(path)
    expect(await reopened.get('k19')).toBe('v19')
    expect(await reopened.get('k0')).toBeNull()
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')))).toHaveLength(19)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe.each([
  ['MemoryKvStore', async (): Promise<KvStore> => new MemoryKvStore()],
  [
    'FileKvStore',
    async (): Promise<KvStore> =>
      new FileKvStore(join(await mkdtemp(join(tmpdir(), 'opper-clone-')), 'kv.json')),
  ],
])('%s keys', (_name, create) => {
  it('lists the keys with a prefix, sorted, and none before the first write', async () => {
    const store = await create()
    expect(await store.keys('account:')).toEqual([])
    await store.put('account:bob', '1')
    await store.put('reconcile:alice', '2')
    await store.put('account:alice', '3')
    await store.put('account:carol', '4')
    await store.delete('account:carol')
    expect(await store.keys('account:')).toEqual(['account:alice', 'account:bob'])
    expect(await store.keys('')).toHaveLength(3)
  })
})
