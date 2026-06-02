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
  environment?: 'sandbox' | 'live'
  warning?: string
}

type SpinnerController = {
  stop: () => void
}

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

export const createInitSession = async (apiBaseUrl: string): Promise<InitSessionResponse> => {
  const response = await fetch(`${apiBaseUrl}/v1/ui/provider/auth/cli-init/sessions`, {
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
        `${apiBaseUrl}/v1/ui/provider/auth/cli-init/sessions/${encodeURIComponent(session.sessionId)}/exchange`,
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

const PRODUCT_REF_PLACEHOLDER = '__SOLVAPAY_PRODUCT_REF__'

export type VerifyProductRefResult =
  | { status: 'skipped' }
  | { status: 'ok' }
  | { status: 'invalid_placeholder' }
  | { status: 'not_found'; body: string }
  | { status: 'error'; message: string }

export const verifyProductRef = async (
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
): Promise<VerifyProductRefResult> => {
  if (productRef === PRODUCT_REF_PLACEHOLDER) {
    return { status: 'invalid_placeholder' }
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/v1/sdk/products/${encodeURIComponent(productRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    )

    if (response.ok) {
      return { status: 'ok' }
    }

    const body = await response.text()
    if (response.status === 404) {
      return { status: 'not_found', body }
    }

    return {
      status: 'error',
      message: `Product lookup failed (${response.status}): ${body}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      status: 'error',
      message: `Product lookup failed due to network error: ${message}`,
    }
  }
}

export type VerifyMerchantResult =
  | { status: 'ok' }
  | {
      status: 'not_found'
      /**
       * Environment the secret key resolved to. Mirrors the exchange
       * response when the backend returns a structured
       * `provider_not_found_in_environment` body; falls back to undefined
       * for older deployments that still return a flat 404.
       */
      environment?: 'sandbox' | 'live'
      /**
       * True when the backend confirms a sandbox `Provider` doc exists
       * for this provider even though the requested env doesn't. Lets
       * the CLI suggest "finish live promotion in the Console" instead
       * of the generic onboarding prompt.
       */
      providerExistsInSandbox?: boolean
    }
  | { status: 'unauthorized' }
  | { status: 'env_mismatch'; keyEnvironment?: 'sandbox' | 'live'; providerEnvironment?: 'sandbox' | 'live' }
  | { status: 'error'; message: string }

const parseJsonSafe = async (response: Response): Promise<unknown> => {
  try {
    return await response.clone().json()
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const pickEnv = (value: unknown): 'sandbox' | 'live' | undefined => {
  return value === 'sandbox' || value === 'live' ? value : undefined
}

/**
 * Hit `GET /v1/sdk/merchant` to confirm the SolvaPay backend has a
 * merchant record for the secret key. Distinct from `verifySecretKey`
 * (which only asserts the key authenticates) because a valid key with
 * no merchant fails every paid-MCP bootstrap call with
 * `Provider not found (404)`. Catching that here lets `solvapay init`
 * hard-block before the user wires up a doomed deploy.
 */
export const verifyMerchant = async (
  apiBaseUrl: string,
  secretKey: string,
): Promise<VerifyMerchantResult> => {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/sdk/merchant`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    })

    if (response.ok) {
      return { status: 'ok' }
    }

    if (response.status === 404) {
      const payload = await parseJsonSafe(response)
      const message = isRecord(payload) ? payload.message : undefined
      const detail = isRecord(message) ? message : payload
      const detailRecord = isRecord(detail) ? detail : undefined
      const code = detailRecord?.code
      if (code === 'provider_not_found_in_environment') {
        return {
          status: 'not_found',
          environment: pickEnv(detailRecord?.requestedEnvironment),
          providerExistsInSandbox:
            typeof detailRecord?.providerExistsInSandbox === 'boolean'
              ? detailRecord.providerExistsInSandbox
              : undefined,
        }
      }
      return { status: 'not_found' }
    }

    if (response.status === 403) {
      const payload = await parseJsonSafe(response)
      const message = isRecord(payload) ? payload.message : undefined
      const detail = isRecord(message) ? message : payload
      const detailRecord = isRecord(detail) ? detail : undefined
      if (detailRecord?.code === 'key_env_mismatch') {
        return {
          status: 'env_mismatch',
          keyEnvironment: pickEnv(detailRecord?.keyEnvironment),
          providerEnvironment: pickEnv(detailRecord?.providerEnvironment),
        }
      }
      const body = await response.text().catch(() => '')
      return {
        status: 'error',
        message: `Merchant lookup failed (403): ${body}`,
      }
    }

    if (response.status === 401) {
      return { status: 'unauthorized' }
    }

    const body = await response.text().catch(() => '')
    return {
      status: 'error',
      message: `Merchant lookup failed (${response.status}): ${body}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      status: 'error',
      message: `Merchant lookup failed due to network error: ${message}`,
    }
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
