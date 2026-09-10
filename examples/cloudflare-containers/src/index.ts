import { Container, getContainer } from '@cloudflare/containers'

export interface Env {
  SOLVAPAY_SECRET_KEY: string
  SOLVAPAY_PRODUCT: string
  MCP_PUBLIC_BASE_URL: string
  SOLVAPAY_API_BASE_URL?: string
}

const forwardedEnv = (env: Env): Record<string, string> => {
  const apiBase = env.SOLVAPAY_API_BASE_URL
  const vars: Record<string, string> = {
    MCP_HOST: '0.0.0.0',
    MCP_PORT: '3030',
    SOLVAPAY_SECRET_KEY: env.SOLVAPAY_SECRET_KEY,
    SOLVAPAY_PRODUCT: env.SOLVAPAY_PRODUCT,
    SOLVAPAY_PRODUCT_REF: env.SOLVAPAY_PRODUCT,
    MCP_PUBLIC_BASE_URL: env.MCP_PUBLIC_BASE_URL,
  }
  if (apiBase) {
    vars.SOLVAPAY_API_BASE_URL = apiBase
  }
  return vars
}

export class WeatherMcp extends Container<Env> {
  defaultPort = 3030
  sleepAfter = '10m'

  override envVars = forwardedEnv(this.env)
}

export class BitcoinMcp extends Container<Env> {
  defaultPort = 3030
  sleepAfter = '10m'

  override envVars = forwardedEnv(this.env)
}

export interface WorkerEnv extends Env {
  WEATHER_MCP?: DurableObjectNamespace<WeatherMcp>
  BITCOIN_MCP?: DurableObjectNamespace<BitcoinMcp>
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (env.WEATHER_MCP) {
      return getContainer(env.WEATHER_MCP).fetch(request)
    }
    if (env.BITCOIN_MCP) {
      return getContainer(env.BITCOIN_MCP).fetch(request)
    }
    throw new Error('WEATHER_MCP or BITCOIN_MCP Durable Object binding is required')
  },
}
