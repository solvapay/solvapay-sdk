import 'dotenv/config'
import crypto from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

type AuthorizationServerMetadata = {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
}

type DynamicClientRegistrationResponse = {
  client_id: string
  client_secret: string
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function createPkce() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest())
  return { codeVerifier, codeChallenge: challenge }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed (${response.status}) ${url}: ${body}`)
  }
  return (await response.json()) as T
}

async function main() {
  const mcpBaseUrl = process.env.MCP_PUBLIC_BASE_URL || 'http://127.0.0.1:3004'
  const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://127.0.0.1:6274/oauth/callback/debug'

  console.log(`1) Fetching resource metadata from ${mcpBaseUrl}`)
  await fetchJson(`${mcpBaseUrl}/.well-known/oauth-protected-resource`)

  console.log('2) Fetching authorization server metadata')
  const metadata = await fetchJson<AuthorizationServerMetadata>(
    `${mcpBaseUrl}/.well-known/oauth-authorization-server`,
  )

  console.log('3) Dynamic client registration')
  const registration = await fetchJson<DynamicClientRegistrationResponse>(metadata.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_name: 'MCP OAuth Bridge Script Client',
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
  const authorizeUrl = `${metadata.authorization_endpoint}?${params.toString()}`

  console.log('\n4) Open this URL in your browser and complete login:')
  console.log(authorizeUrl)
  console.log('\nPaste the returned `code` query parameter below.\n')

  const rl = readline.createInterface({ input, output })
  const code = (await rl.question('Authorization code: ')).trim()
  await rl.close()

  if (!code) {
    throw new Error('Authorization code is required')
  }

  console.log('5) Exchanging code for token')
  const tokenResponse = await fetchJson<{
    access_token: string
    token_type: string
    expires_in: number
  }>(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      code_verifier: codeVerifier,
    }),
  })

  console.log('6) Calling MCP initialize')
  const initResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tokenResponse.access_token}`,
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'oauth-flow-script', version: '1.0.0' },
      },
    }),
  })

  if (!initResponse.ok) {
    throw new Error(`Initialize failed: ${initResponse.status} ${await initResponse.text()}`)
  }

  const sessionId = initResponse.headers.get('MCP-Session-Id')
  if (!sessionId) {
    throw new Error('MCP-Session-Id missing from initialize response')
  }

  console.log('7) Calling tools/call')
  const toolResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tokenResponse.access_token}`,
      'MCP-Session-Id': sessionId,
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          title: 'OAuth bridge task',
          description: 'Created by flow script',
        },
      },
    }),
  })

  const body = await toolResponse.text()
  console.log('\nTool call HTTP status:', toolResponse.status)
  console.log('Tool call response:')
  console.log(body)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
