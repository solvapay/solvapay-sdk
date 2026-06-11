const INIT_EXCHANGE_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 2000

export type CustomerInitSessionResponse = {
  sessionId: string
  authUrl: string
  pollToken: string
}

export type CustomerInitSessionOptions = {
  externalRefHint?: string
  consentSessionKey?: string
}

type CustomerExchangeStatus = 'pending' | 'complete' | 'expired' | 'cancelled'

type SpinnerController = {
  stop: () => void
}

export type CustomerExchangeResponse =
  | { status: 'pending' | 'expired' | 'cancelled' }
  | { status: 'complete'; target: 'sdk'; credential: string; customerRef: string }
  | { status: 'complete'; target: 'consent'; consentSid: string; customerRef?: string }

const sleep = async (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const startSpinner = (message: string): SpinnerController => {
  if (!process.stdout.isTTY) {
    return { stop: () => {} }
  }

  const frames = ['|', '/', '-', '\\']
  let frameIndex = 0
  process.stdout.write(`${message} ${frames[frameIndex]}`)
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length
    process.stdout.write(`\r${message} ${frames[frameIndex]}`)
  }, 100)

  return {
    stop: () => {
      clearInterval(timer)
      process.stdout.write(`\r${' '.repeat(message.length + 4)}\r`)
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isStatus = (value: unknown): value is CustomerExchangeStatus =>
  value === 'pending' || value === 'complete' || value === 'expired' || value === 'cancelled'

export const createCustomerInitSession = async (
  apiBaseUrl: string,
  options: CustomerInitSessionOptions = {},
): Promise<CustomerInitSessionResponse> => {
  const response = await fetch(`${apiBaseUrl}/v1/ui/customer/auth/cli-init/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to start customer init session (${response.status}): ${body}`)
  }

  return (await response.json()) as CustomerInitSessionResponse
}

export const waitForCustomerExchange = async (
  apiBaseUrl: string,
  session: CustomerInitSessionResponse,
): Promise<CustomerExchangeResponse> => {
  const startedAt = Date.now()
  const spinner = startSpinner('Waiting for customer authentication...')

  try {
    while (Date.now() - startedAt < INIT_EXCHANGE_TIMEOUT_MS) {
      const response = await fetch(
        `${apiBaseUrl}/v1/ui/customer/auth/cli-init/sessions/${encodeURIComponent(session.sessionId)}/exchange`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.pollToken}`,
          },
        },
      )

      if (response.status === 202 || response.status === 409) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Customer init exchange failed (${response.status}): ${body}`)
      }

      const payload = await response.json()
      if (!isRecord(payload) || !isStatus(payload.status)) {
        throw new Error('Customer init exchange returned an invalid payload shape.')
      }

      if (payload.status === 'pending') {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      if (payload.status === 'complete') {
        if (payload.target === 'consent') {
          if (typeof payload.consentSid !== 'string') {
            throw new Error('Customer init completed without consent session key.')
          }

          return {
            status: 'complete',
            target: 'consent',
            consentSid: payload.consentSid,
            customerRef:
              typeof payload.customerRef === 'string' ? payload.customerRef : undefined,
          }
        }

        if (
          payload.target !== 'sdk' ||
          typeof payload.credential !== 'string' ||
          typeof payload.customerRef !== 'string'
        ) {
          throw new Error('Customer init completed without SDK credential.')
        }

        return {
          status: 'complete',
          target: 'sdk',
          credential: payload.credential,
          customerRef: payload.customerRef,
        }
      }

      if (payload.status === 'expired' || payload.status === 'cancelled') {
        return { status: payload.status }
      }

      throw new Error('Customer init exchange returned an invalid completion payload shape.')
    }

    return { status: 'expired' }
  } finally {
    spinner.stop()
  }
}
