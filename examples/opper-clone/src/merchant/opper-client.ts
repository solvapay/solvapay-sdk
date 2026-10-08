// Ported from solvapay/opper-mcp src/opper/client.ts: the project, key and
// spend calls only. Budget rules are left out: SolvaPay credits decide, with
// no cap mirror at Opper (prototype spec §8.2a).
import { isRecord, requireInteger, requireString } from '../lib/guards'

export class OpperUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OpperUpstreamError'
  }
}

export interface OpperProject {
  uuid: string
  name: string
}

export interface OpperKeyMeta {
  id: number
  name: string
}

export interface MintedKey extends OpperKeyMeta {
  /** Null when Opper replays an idempotent mint and does not return the secret again. */
  key: string | null
}

export interface ProjectSpend {
  spentCents: number
  limitCents: number | null
  blocked: boolean
  blockReason: string | null
}

/** What the per-user accounts need from Opper's Management API. */
export interface OpperManagement {
  createProject(name: string): Promise<OpperProject>
  mintKey(projectUuid: string, name: string, idempotencyKey: string): Promise<MintedKey>
  deleteKey(projectUuid: string, id: number): Promise<void>
  getMe(runtimeKey: string): Promise<ProjectSpend>
}

export class OpperClient implements OpperManagement {
  constructor(
    private readonly baseUrl: string,
    private readonly managementKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createProject(name: string): Promise<OpperProject> {
    try {
      const { data } = await this.request('POST', '/management/v1/projects', this.managementKey, {
        name,
      })
      return parseProject(unwrapData(data))
    } catch (error) {
      if (!(error instanceof OpperUpstreamError) || error.status !== 409) throw error
      const existing = await this.findProjectByName(name)
      if (!existing) {
        throw new OpperUpstreamError(`Project ${name} already exists but could not be listed`, 409)
      }
      return existing
    }
  }

  async findProjectByName(name: string): Promise<OpperProject | null> {
    const { data } = await this.request('GET', '/management/v1/projects', this.managementKey)
    for (const row of unwrapList(data)) {
      if (isRecord(row) && row.name === name && typeof row.uuid === 'string') {
        return { uuid: row.uuid, name }
      }
    }
    return null
  }

  async mintKey(projectUuid: string, name: string, idempotencyKey: string): Promise<MintedKey> {
    const { status, data } = await this.request(
      'POST',
      `/management/v1/projects/${projectUuid}/api-keys`,
      this.managementKey,
      { name, return_secret: true, idempotency_key: idempotencyKey },
    )
    const created = unwrapData(data)
    return {
      id: requireInteger(created.id, 'api key id'),
      name: requireString(created.name, 'api key name'),
      key: status === 201 && typeof created.key === 'string' ? created.key : null,
    }
  }

  async deleteKey(projectUuid: string, id: number): Promise<void> {
    await this.request(
      'DELETE',
      `/management/v1/projects/${projectUuid}/api-keys/${id}`,
      this.managementKey,
    )
  }

  async getMe(runtimeKey: string): Promise<ProjectSpend> {
    const { data } = await this.request('GET', '/v3/me', runtimeKey)
    if (!isRecord(data) || !isRecord(data.project_spend)) {
      throw new OpperUpstreamError('GET /v3/me did not include project_spend', 200)
    }
    const spend = data.project_spend
    return {
      spentCents: requireInteger(spend.spent_cents, 'project_spend.spent_cents'),
      limitCents:
        spend.limit_cents === null
          ? null
          : requireInteger(spend.limit_cents, 'project_spend.limit_cents'),
      blocked: data.blocked === true,
      blockReason: typeof data.block_reason === 'string' ? data.block_reason : null,
    }
  }

  private async request(
    method: string,
    path: string,
    bearer: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new OpperUpstreamError(
        `${method} ${path} failed with HTTP ${response.status}${errorCode(text)}`,
        response.status,
      )
    }
    if (!text) return { status: response.status, data: null }
    try {
      return { status: response.status, data: JSON.parse(text) as unknown }
    } catch {
      throw new OpperUpstreamError(`${method} ${path} returned non-JSON`, response.status)
    }
  }
}

function errorCode(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) return ''
    const error = parsed.error
    if (typeof error === 'string') return `: ${error}`
    if (isRecord(error) && typeof error.code === 'string') return `: ${error.code}`
    return ''
  } catch {
    return ''
  }
}

function unwrapData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new OpperUpstreamError('Opper response was missing data', 200)
  }
  return value.data
}

function unwrapList(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new OpperUpstreamError('Opper response was missing a data list', 200)
  }
  return value.data
}

function parseProject(data: Record<string, unknown>): OpperProject {
  return {
    uuid: requireString(data.uuid, 'project uuid'),
    name: requireString(data.name, 'project name'),
  }
}
