import open from 'open'

const INIT_EXCHANGE_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 2000

export type InitSessionResponse = {
  sessionId: string
  authUrl: string
  pollToken: string
}

export type ExchangeResponse = {
  status: 'pending' | 'complete' | 'expired' | 'cancelled'
  secretKey?: string
  email?: string
}

type SpinnerController = {
  stop: () => void
}

const sleep = async (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const startSpinner = (message: string): SpinnerController => {
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

export const createInitSession = async (apiBaseUrl: string): Promise<InitSessionResponse> => {
  const response = await fetch(`${apiBaseUrl}/v1/oauth/init/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to start init session (${response.status}): ${body}`)
  }

  return (await response.json()) as InitSessionResponse
}

export const openAuthUrl = async (authUrl: string): Promise<boolean> => {
  try {
    await open(authUrl)
    return true
  } catch {
    return false
  }
}

export const waitForExchange = async (
  apiBaseUrl: string,
  session: InitSessionResponse,
): Promise<ExchangeResponse> => {
  const startedAt = Date.now()
  const spinner = startSpinner('⏳ Waiting for authentication...')

  try {
    while (Date.now() - startedAt < INIT_EXCHANGE_TIMEOUT_MS) {
      const response = await fetch(
        `${apiBaseUrl}/v1/oauth/init/session/${encodeURIComponent(session.sessionId)}/exchange`,
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
        throw new Error(`Init exchange failed (${response.status}): ${body}`)
      }

      const payload = (await response.json()) as ExchangeResponse
      if (payload.status === 'pending') {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      return payload
    }

    return {
      status: 'expired',
    }
  } finally {
    spinner.stop()
  }
}

export const verifySecretKey = async (
  apiBaseUrl: string,
  secretKey: string,
): Promise<{ ok: boolean; warning?: string }> => {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/sdk/products`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    })

    if (response.ok) {
      return { ok: true }
    }

    const body = await response.text()
    return {
      ok: false,
      warning: `Verification failed (${response.status}): ${body}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      ok: false,
      warning: `Verification failed due to network error: ${message}`,
    }
  }
}
