// Signs in to a SolvaPay account by email code and creates an agent for this
// merchant, saving the agent credential to data/agent-credential (git-ignored,
// mode 600). The credential is never printed.
//
//   pnpm agent:connect login <email>
//   pnpm agent:connect verify <email> <code> [agent name]
import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [command, email, code, ...nameParts] = process.argv.slice(2)
const base = required('SOLVAPAY_API_BASE_URL').replace(/\/+$/, '')
const providerRef = required('SOLVAPAY_PROVIDER_REF')
const dataDir = fileURLToPath(new URL('../data/', import.meta.url))

if (command === 'login' && email) {
  await call('POST', '/v1/account/auth/logins', { email })
  process.stdout.write(`Code sent to ${email}. Then: pnpm agent:connect verify ${email} <code>\n`)
} else if (command === 'verify' && email && code) {
  const session = await call('POST', '/v1/account/auth/logins/verifications', { email, code })
  const created = await call(
    'POST',
    '/v1/account/agents',
    { providerRef, name: nameParts.join(' ') || 'Claude Code' },
    session.token as string,
  )
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'agent-credential'), created.credential as string, { mode: 0o600 })
  const agent = created.agent as { reference: string; principalRef: string }
  process.stdout.write(
    `Account ${(session.account as { reference: string }).reference}, ` +
      `agent ${agent.reference}, principal ${agent.principalRef} at ${providerRef}.\n` +
      'Credential saved to data/agent-credential.\n',
  )
} else {
  process.stderr.write(
    'Usage: pnpm agent:connect login <email>\n' +
      '       pnpm agent:connect verify <email> <code> [agent name]\n',
  )
  process.exit(1)
}

async function call(
  method: string,
  path: string,
  body: unknown,
  bearer?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    process.stderr.write(`${method} ${path} failed with HTTP ${response.status}: ${text}\n`)
    process.exit(1)
  }
  return JSON.parse(text) as Record<string, unknown>
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set in .env`)
  return value
}
