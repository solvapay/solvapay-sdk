// MPP (Machine Payments Protocol, HTTP 402) for a merchant's paid HTTP API,
// in preview. An agent with no SolvaPay key gets a 402 with an MPP challenge;
// its first payment buys a balance at the merchant and SolvaPay gives it an
// agent key, which it sends on later calls. SolvaPay checks every credential
// and records every payment: the merchant's SDK only carries headers.
import { AgentApiError, type MoneyAmount } from './client'
import { isRecord, requireString } from './guards'

/** The header a 402 carries the challenge in, one value per payment method. */
export const MPP_CHALLENGE_HEADER = 'WWW-Authenticate'
/** Where an agent sends its credential when `Authorization` carries its key. */
export const MPP_PAYMENT_AUTHORIZATION_HEADER = 'Payment-Authorization'
/** The header the paid response carries the receipt in. */
export const MPP_RECEIPT_HEADER = 'Payment-Receipt'
/** The header a new MPP payer gets its SolvaPay agent key in, once. */
export const MPP_AGENT_KEY_HEADER = 'SolvaPay-Agent-Key'

const CREDENTIAL_SCHEME = 'Payment '

/**
 * The MPP credential a request carries: `Payment-Authorization`, else an
 * `Authorization` in the `Payment` scheme. Null when there is none.
 */
export function mppCredentialOf(headers: Headers): string | null {
  const dedicated = headers.get(MPP_PAYMENT_AUTHORIZATION_HEADER)
  if (dedicated) {
    if (!dedicated.startsWith(CREDENTIAL_SCHEME)) {
      throw new Error(`${MPP_PAYMENT_AUTHORIZATION_HEADER} must use the Payment scheme`)
    }
    return dedicated
  }
  const authorization = headers.get('authorization')
  return authorization?.startsWith(CREDENTIAL_SCHEME) ? authorization : null
}

export interface MppReceipt {
  method: string
  /** For a card payment, the PaymentIntent on the merchant's own Stripe account. */
  reference: string
  status: 'success'
  timestamp: string
}

export type MppCredentialResult =
  | {
      status: 'paid'
      /** The new payer's key, on its first payment only. */
      agentKey?: string
      agentRef: string
      customerRef: string
      lot: { reference: string; paymentIntentId: string; amount: MoneyAmount }
      receipt: MppReceipt
    }
  | {
      status: 'refused'
      wwwAuthenticate: string[]
      problem: { type?: string; title?: string; detail?: string }
    }

export interface SolvaPayMppClient {
  /** The challenge for one balance lot. `agentKey`: an MPP payer short of balance. */
  challenge(input: {
    realm: string
    agentKey?: string
  }): Promise<{ wwwAuthenticate: string[]; lot: { amount: MoneyAmount } }>
  /** Checks a credential; a paid one has bought a lot. */
  credential(input: {
    realm: string
    authorization: string
    agentKey?: string
  }): Promise<MppCredentialResult>
}

const TIMEOUT_MS = 30_000

export function createSolvaPayMppClient(options: {
  apiBaseUrl: string
  secretKey: string
  fetchImpl?: typeof fetch
}): SolvaPayMppClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, '')
  async function post(path: string, body: unknown): Promise<unknown> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // A credential is charged on Stripe before SolvaPay answers.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new AgentApiError(`POST ${path} failed (${response.status}): ${text}`, response.status)
    }
    return JSON.parse(text)
  }
  return {
    challenge: async input => parseChallenge(await post('/v1/sdk/agent/mpp/challenges', input)),
    credential: async input => parseCredential(await post('/v1/sdk/agent/mpp/credentials', input)),
  }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a non-empty list`)
  return value.map((item, i) => requireString(item, `${label}[${i}]`))
}

function money(value: unknown, label: string): MoneyAmount {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return {
    amount: requireString(value.amount, `${label}.amount`),
    currency: requireString(value.currency, `${label}.currency`),
  }
}

export function parseChallenge(
  value: unknown,
): Awaited<ReturnType<SolvaPayMppClient['challenge']>> {
  if (!isRecord(value) || !isRecord(value.lot)) throw new Error('MPP challenge was not an object')
  return {
    wwwAuthenticate: stringList(value.wwwAuthenticate, 'wwwAuthenticate'),
    lot: { amount: money(value.lot.amount, 'lot.amount') },
  }
}

/** Checked field by field: the payer is served on it. */
export function parseCredential(value: unknown): MppCredentialResult {
  if (!isRecord(value)) throw new Error('MPP credential answer was not an object')
  if (value.status === 'refused') {
    const problem = isRecord(value.problem) ? value.problem : {}
    const optional = (field: 'type' | 'title' | 'detail') =>
      typeof problem[field] === 'string' ? { [field]: problem[field] as string } : {}
    return {
      status: 'refused',
      wwwAuthenticate: stringList(value.wwwAuthenticate, 'wwwAuthenticate'),
      problem: { ...optional('type'), ...optional('title'), ...optional('detail') },
    }
  }
  if (value.status !== 'paid')
    throw new Error(`MPP credential status ${String(value.status)} is not paid or refused`)
  if (!isRecord(value.lot) || !isRecord(value.receipt))
    throw new Error('A paid answer needs lot and receipt')
  if (value.receipt.status !== 'success') throw new Error('receipt.status must be success')
  return {
    status: 'paid',
    ...(value.agentKey === undefined
      ? {}
      : { agentKey: requireString(value.agentKey, 'agentKey') }),
    agentRef: requireString(value.agentRef, 'agentRef'),
    customerRef: requireString(value.customerRef, 'customerRef'),
    lot: {
      reference: requireString(value.lot.reference, 'lot.reference'),
      paymentIntentId: requireString(value.lot.paymentIntentId, 'lot.paymentIntentId'),
      amount: money(value.lot.amount, 'lot.amount'),
    },
    receipt: {
      method: requireString(value.receipt.method, 'receipt.method'),
      reference: requireString(value.receipt.reference, 'receipt.reference'),
      status: 'success',
      timestamp: requireString(value.receipt.timestamp, 'receipt.timestamp'),
    },
  }
}

/**
 * The `Payment-Receipt` value: MPP's receipt (base64url JSON) with SolvaPay's
 * call reference added, so the payer can name the call it paid for.
 */
export function encodeMppReceipt(receipt: MppReceipt, callRef: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify({ ...receipt, callRef }))) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
