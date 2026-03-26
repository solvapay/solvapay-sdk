import {
  createInitSession,
  openAuthUrl,
  verifySecretKey,
  waitForExchange,
} from '../lib/browser-auth'
import { writeSolvaPaySecretToEnv } from '../lib/env'

const DEFAULT_API_BASE_URL = 'https://api.solvapay.com'

const resolveApiBaseUrl = (): string =>
  (process.env.SOLVAPAY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

export const runInitCommand = async (): Promise<void> => {
  const apiBaseUrl = resolveApiBaseUrl()

  process.stdout.write('Opening browser to sign in...\n')
  const initSession = await createInitSession(apiBaseUrl)

  const opened = await openAuthUrl(initSession.authUrl)
  if (!opened) {
    process.stdout.write(`Open this URL to sign in: ${initSession.authUrl}\n`)
  }

  const exchange = await waitForExchange(apiBaseUrl, initSession)

  if (exchange.status === 'cancelled') {
    throw new Error('The browser flow was cancelled before completion.')
  }
  if (exchange.status === 'expired') {
    throw new Error(
      'Timed out after 5 minutes waiting for browser auth. Please run `solvapay init` again.',
    )
  }
  if (exchange.status !== 'complete' || !exchange.secretKey) {
    throw new Error('Could not retrieve a SolvaPay secret key from the init session.')
  }

  if (exchange.email) {
    process.stdout.write(`✓ Authenticated as ${exchange.email}\n`)
  } else {
    process.stdout.write('✓ Authenticated\n')
  }

  const envWrite = await writeSolvaPaySecretToEnv(exchange.secretKey)
  if (envWrite.action === 'unchanged') {
    process.stdout.write('Skipped writing SOLVAPAY_SECRET_KEY to .env\n')
    return
  }

  process.stdout.write('✓ SOLVAPAY_SECRET_KEY written to .env\n')

  const verified = await verifySecretKey(apiBaseUrl, exchange.secretKey)
  if (verified.ok) {
    process.stdout.write('✓ Connected to SolvaPay\n')
    return
  }

  process.stdout.write(
    `! Key written, but verification failed. You can continue. Details: ${verified.warning}\n`,
  )
}
