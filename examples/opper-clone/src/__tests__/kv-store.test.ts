import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileKvStore } from '../lib/kv-store'

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
