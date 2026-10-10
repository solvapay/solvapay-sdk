import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isRecord } from './guards'

/** The subset of opper-mcp's KvStore the clone needs. */
export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** The keys that start with `prefix`, sorted. */
  keys(prefix: string): Promise<string[]>
}

export class MemoryKvStore implements KvStore {
  private readonly entries = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort()
  }
}

/**
 * One JSON file, rewritten atomically (temp file then rename). Writes are
 * serialised in process; the clone runs as a single process.
 */
export class FileKvStore implements KvStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string) {}

  async get(key: string): Promise<string | null> {
    await this.queue
    const entries = await this.readAll()
    return entries[key] ?? null
  }

  put(key: string, value: string): Promise<void> {
    return this.mutate(entries => {
      entries[key] = value
    })
  }

  delete(key: string): Promise<void> {
    return this.mutate(entries => {
      delete entries[key]
    })
  }

  async keys(prefix: string): Promise<string[]> {
    await this.queue
    const entries = await this.readAll()
    return Object.keys(entries)
      .filter(key => key.startsWith(prefix))
      .sort()
  }

  private mutate(change: (entries: Record<string, string>) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const entries = await this.readAll()
      change(entries)
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 })
      await rename(tmp, this.path)
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private async readAll(): Promise<Record<string, string>> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) throw new Error(`${this.path} is not a JSON object`)
    const entries: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') throw new Error(`${this.path}: ${key} is not a string`)
      entries[key] = value
    }
    return entries
  }
}
