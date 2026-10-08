// Forwards a call to Opper's compatibility API with the user's runtime key and
// streams the answer back untouched.
//
// Where Opper reports cost (S1 spike, 8 Oct 2026): a plain call carries
// `X-Opper-Cost`; a streamed call has no cost header, and the cost arrives in
// the final `message_delta` event as `usage.cost` (USD).
import { isRecord } from '../lib/guards'

/** Request headers that never go upstream: the caller's credentials and hop-by-hop headers. */
const DROP_REQUEST_HEADERS = [
  'authorization',
  'x-api-key',
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'x-opper-tags',
]

/** Response headers that would be wrong once fetch has decoded the body. */
const DROP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]

const MAX_TAGS = 8

export type CostReading =
  | { usd: number; source: 'x-opper-cost' | 'stream-message-delta' }
  | { usd: null; source: 'missing' | 'unparseable'; raw?: string }

export interface Completion {
  cost: CostReading
  status: number
  /** Names of every `x-opper-*` response header, for the streaming-cost spike (S1 task 1.5). */
  opperHeaders: string[]
  streamed: boolean
  bytes: number
  /** `x-opper-trace-id`, the handle for reconciling against Opper's logs. */
  traceId: string | null
}

export interface ForwardInput {
  request: Request
  /** Path below `/v3/compat`, for example `/v1/messages`. */
  subpath: string
  /** The user's Opper key, or null to forward a call that presented no key. */
  runtimeKey: string | null
  tags: Record<string, string>
}

export interface Forwarded {
  response: Response
  /** Resolves once the body has been fully sent to the caller. */
  completion: Promise<Completion>
}

export interface OpperUpstream {
  forward(input: ForwardInput): Promise<Forwarded>
}

export function createOpperUpstream(options: {
  baseUrl: string
  fetchImpl?: typeof fetch
}): OpperUpstream {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    async forward({ request, subpath, runtimeKey, tags }) {
      const source = new URL(request.url)
      const target = `${options.baseUrl}/v3/compat${subpath}${source.search}`
      const headers = new Headers(request.headers)
      for (const name of DROP_REQUEST_HEADERS) headers.delete(name)
      if (runtimeKey) headers.set('authorization', `Bearer ${runtimeKey}`)
      headers.set('accept-encoding', 'identity')
      headers.set('x-opper-tags', formatTags(tags))

      const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
      const upstream = await fetchImpl(target, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
      })

      const responseHeaders = new Headers(upstream.headers)
      for (const name of DROP_RESPONSE_HEADERS) responseHeaders.delete(name)
      const streamed = (upstream.headers.get('content-type') ?? '').includes('text/event-stream')
      const base = {
        cost: readCost(upstream.headers),
        status: upstream.status,
        opperHeaders: [...upstream.headers.keys()].filter(name => name.startsWith('x-opper-')),
        streamed,
        traceId: upstream.headers.get('x-opper-trace-id'),
      }

      if (!upstream.body) {
        return {
          response: new Response(null, { status: upstream.status, headers: responseHeaders }),
          completion: Promise.resolve({ ...base, bytes: 0 }),
        }
      }

      let bytes = 0
      const scanner = streamed ? new StreamCostScanner() : null
      let finish: (completion: Completion) => void = () => undefined
      let fail: (error: unknown) => void = () => undefined
      const completion = new Promise<Completion>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength
          scanner?.push(chunk)
          controller.enqueue(chunk)
        },
        flush() {
          finish({ ...base, bytes, cost: scanner ? scanner.finish() : base.cost })
        },
      })
      upstream.body.pipeTo(counter.writable).catch(fail)

      return {
        response: new Response(counter.readable, {
          status: upstream.status,
          headers: responseHeaders,
        }),
        completion,
      }
    },
  }
}

export function formatTags(tags: Record<string, string>): string {
  const pairs = Object.entries(tags)
  if (pairs.length > MAX_TAGS) throw new Error(`X-Opper-Tags takes at most ${MAX_TAGS} pairs`)
  for (const [key, value] of pairs) {
    if (/[,:]/.test(key) || /[,:]/.test(value)) {
      throw new Error(`Tag ${key} contains a comma or colon`)
    }
  }
  return pairs.map(([key, value]) => `${key}:${value}`).join(',')
}

export function readCost(headers: Headers): CostReading {
  const raw = headers.get('x-opper-cost')
  if (raw === null) return { usd: null, source: 'missing' }
  const usd = Number(raw)
  if (!Number.isFinite(usd) || usd < 0) return { usd: null, source: 'unparseable', raw }
  return { usd, source: 'x-opper-cost' }
}

/**
 * Reads the cost from an Anthropic-shaped SSE stream without holding it: only
 * the unfinished tail of the last event is kept between chunks.
 */
export class StreamCostScanner {
  private readonly decoder = new TextDecoder()
  private pending = ''
  private cost: CostReading = { usd: null, source: 'missing' }

  push(chunk: Uint8Array): void {
    this.pending += this.decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let end = this.pending.indexOf('\n\n')
    while (end !== -1) {
      this.readEvent(this.pending.slice(0, end))
      this.pending = this.pending.slice(end + 2)
      end = this.pending.indexOf('\n\n')
    }
  }

  finish(): CostReading {
    this.pending += this.decoder.decode()
    if (this.pending.trim()) this.readEvent(this.pending)
    this.pending = ''
    return this.cost
  }

  private readEvent(event: string): void {
    const data = event
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data.includes('message_delta')) return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(parsed) || parsed.type !== 'message_delta' || !isRecord(parsed.usage)) return
    const usd = parsed.usage.cost
    this.cost =
      typeof usd === 'number' && Number.isFinite(usd) && usd >= 0
        ? { usd, source: 'stream-message-delta' }
        : { usd: null, source: 'unparseable', raw: JSON.stringify(usd) }
  }
}
