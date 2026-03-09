import crypto from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin, stderr } from 'node:process'

/**
 * Accepts a raw code value, a query string like `code=xxx&state=yyy`,
 * or a full redirect URL, and extracts just the authorization code.
 */
function extractCode(input: string): string {
  try {
    const url = new URL(input)
    const code = url.searchParams.get('code')
    if (code) return code
  } catch {}

  if (input.includes('code=')) {
    const params = new URLSearchParams(input.startsWith('?') ? input : `?${input}`)
    const code = params.get('code')
    if (code) return code
  }

  return input
}

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function createPkce() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest())
  return { codeVerifier, codeChallenge }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OAuth request failed (${response.status}) ${url}: ${body}`)
  }
  return (await response.json()) as T
}

/**
 * Runs the full OAuth authorization code + PKCE flow interactively.
 * The user opens a URL in their browser and pastes back the authorization code.
 * Returns a valid access token for the given MCP server.
 */
export async function acquireOAuthToken(mcpServerUrl: string): Promise<string> {
  const baseUrl = mcpServerUrl.replace(/\/$/, '')
  const redirectUri = 'http://localhost:6274/oauth/callback/debug'

  console.error('[OAuth] Fetching authorization server metadata...')
  const metadata = await fetchJson<{
    authorization_endpoint: string
    token_endpoint: string
    registration_endpoint: string
  }>(`${baseUrl}/.well-known/oauth-authorization-server`)

  console.error('[OAuth] Registering dynamic client...')
  const registration = await fetchJson<{
    client_id: string
    client_secret: string
  }>(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'MCP Benchmark Client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })

  const state = crypto.randomUUID()
  const { codeVerifier, codeChallenge } = createPkce()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  console.error('')
  console.error('Open this URL in your browser and log in:')
  console.error(`  ${metadata.authorization_endpoint}?${params}`)
  console.error('')
  console.error('After login, paste the "code" query parameter from the redirect URL.')
  console.error('')

  const rl = readline.createInterface({ input: stdin, output: stderr })
  const raw = (await rl.question('Authorization code: ')).trim()
  rl.close()

  if (!raw) throw new Error('Authorization code is required')

  const code = extractCode(raw)

  console.error('[OAuth] Exchanging code for access token...')
  const tokenResponse = await fetchJson<{
    access_token: string
    token_type: string
    expires_in: number
  }>(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      code_verifier: codeVerifier,
    }),
  })

  return tokenResponse.access_token
}
