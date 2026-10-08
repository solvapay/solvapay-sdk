import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type {
  MintedKey,
  OpperManagement,
  OpperProject,
  ProjectSpend,
} from '../merchant/opper-client'

/** In-memory stand-in for Opper's Management API. */
export class FakeOpperManagement implements OpperManagement {
  readonly projects = new Map<string, OpperProject>()
  readonly keys = new Map<number, { projectUuid: string; secret: string }>()
  readonly calls: string[] = []
  /** Idempotency keys already used; a replay returns no secret, as Opper does. */
  private readonly minted = new Map<string, number>()
  private nextKeyId = 1

  async createProject(name: string): Promise<OpperProject> {
    this.calls.push(`createProject ${name}`)
    await tick()
    const existing = this.projects.get(name)
    if (existing) return existing
    const project = { uuid: `uuid-${name}`, name }
    this.projects.set(name, project)
    return project
  }

  async mintKey(projectUuid: string, name: string, idempotencyKey: string): Promise<MintedKey> {
    this.calls.push(`mintKey ${idempotencyKey}`)
    await tick()
    const replayed = this.minted.get(idempotencyKey)
    if (replayed !== undefined) return { id: replayed, name, key: null }
    const id = this.nextKeyId++
    const secret = `op-secret-${id}`
    this.keys.set(id, { projectUuid, secret })
    this.minted.set(idempotencyKey, id)
    return { id, name, key: secret }
  }

  async deleteKey(_projectUuid: string, id: number): Promise<void> {
    this.calls.push(`deleteKey ${id}`)
    this.keys.delete(id)
  }

  async getMe(runtimeKey: string): Promise<ProjectSpend> {
    this.calls.push('getMe')
    if (![...this.keys.values()].some(key => key.secret === runtimeKey)) {
      throw new Error('unknown runtime key')
    }
    return { spentCents: 12, limitCents: null, blocked: false, blockReason: null }
  }

  /** Simulates a previous run that minted a key and crashed before storing it. */
  preMint(idempotencyKey: string): void {
    this.minted.set(idempotencyKey, this.nextKeyId)
    this.keys.set(this.nextKeyId, { projectUuid: 'lost', secret: 'lost-secret' })
    this.nextKeyId++
  }
}

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 5))
}

/** A Response whose body arrives in several chunks, like an SSE stream. */
export function chunkedResponse(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      controller.close()
    },
  })
  return new Response(body, { status: init.status ?? 200, headers: init.headers })
}

/** SolvaPay agent token test fixtures. */
export const ISSUER = 'https://api.solvapay.test/v1/agent'
export const PROVIDER = 'prov_W3TLPNOA'

export async function agentKeys() {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  return { privateKey: pair.privateKey, publicJwk: jwk }
}

export function signAgentToken(
  key: CryptoKey,
  overrides: {
    iss?: string
    aud?: string
    sub?: string
    principal?: string | null
    scope?: string
    expiresIn?: string
    kid?: string
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = { scope: overrides.scope ?? 'inference' }
  if (overrides.principal !== null) claims.principal = overrides.principal ?? 'ppl_ABCDEFGHIJKLMNOP'
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: overrides.kid ?? 'k1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? PROVIDER)
    .setSubject(overrides.sub ?? 'agt_TESTAGNT')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '15m')
    .sign(key)
}
