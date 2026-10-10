// Ported from solvapay/opper-mcp src/opper/client.ts: the project, key and
// spend calls only. Budget rules are left out: SolvaPay credits decide, with
// no cap mirror at Opper (prototype spec §8.2a). The usage read-back
// (`GET /v2/analytics/usage`) is live but missing from Opper's OpenAPI; its
// shape follows docs.opper.ai/build/gateway/usage-attribution.
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

export interface UsageQuery {
  /** Tag keys to split by; untagged usage comes back with the key `null`. */
  groupBy: string[]
  granularity: 'minute' | 'hour' | 'day' | 'month' | 'year'
  /** Inclusive, ISO 8601. Opper defaults to the start of the current month. */
  from?: string
  /** Exclusive, ISO 8601. */
  to?: string
}

export interface UsageRow {
  timeBucket: string
  /** USD as Opper sends it, a decimal string. */
  cost: string
  /** One value per `groupBy` key; null for usage without that tag. */
  groups: Record<string, string | null>
}

/** What the per-user accounts need from Opper's Management API. */
export interface OpperManagement {
  createProject(name: string): Promise<OpperProject>
  mintKey(projectUuid: string, name: string, idempotencyKey: string): Promise<MintedKey>
  deleteKey(projectUuid: string, id: number): Promise<void>
  getMe(runtimeKey: string): Promise<ProjectSpend>
  getUsage(runtimeKey: string, query: UsageQuery): Promise<UsageRow[]>
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

  async getUsage(runtimeKey: string, query: UsageQuery): Promise<UsageRow[]> {
    const params = new URLSearchParams({
      group_by: query.groupBy.join(','),
      granularity: query.granularity,
    })
    if (query.from) params.set('from_date', query.from)
    if (query.to) params.set('to_date', query.to)
    const { data } = await this.request('GET', `/v2/analytics/usage?${params}`, runtimeKey)
    if (!Array.isArray(data)) {
      throw new OpperUpstreamError('GET /v2/analytics/usage did not return a list', 200)
    }
    return data.map(row => parseUsageRow(row, query.groupBy))
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

function parseUsageRow(row: unknown, groupBy: string[]): UsageRow {
  if (!isRecord(row)) throw new OpperUpstreamError('Usage row was not an object', 200)
  const groups: Record<string, string | null> = {}
  for (const key of groupBy) {
    const value = row[key]
    if (value !== null && typeof value !== 'string') {
      throw new OpperUpstreamError(`Usage row ${key} was neither a string nor null`, 200)
    }
    groups[key] = value
  }
  return {
    timeBucket: requireString(row.time_bucket, 'usage time_bucket'),
    cost: requireString(row.cost, 'usage cost'),
    groups,
  }
}
