// Hermes: the key goes in its `.env`, the merchant's MCP server and model
// provider in its `config.yaml`. Hermes reads both itself, so this is the one
// agent whose settings outlive a launch.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'

/** The env var an agent key for this merchant is saved under, e.g. `SOLVAPAY_KEY_PROV_E4YWS8H8`. */
export function keyEnvName(providerRef) {
  return `SOLVAPAY_KEY_${providerRef.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** A name Hermes can use for the merchant's MCP server and model provider, e.g. `opper`. */
export function serverName(merchantName) {
  const slug = merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`Cannot make a server name from "${merchantName}"`)
  return slug
}

function hermesHome(env) {
  return env.HERMES_HOME || join(homedir(), '.hermes')
}

/** The key into Hermes's `.env`; the merchant's MCP server and model provider into its `config.yaml`. */
export async function saveForHermes(env, state, answer) {
  const home = hermesHome(env)
  await mkdir(home, { recursive: true })
  const envName = keyEnvName(answer.providerRef)
  const envFile = join(home, '.env')
  const current = existsSync(envFile) ? await readFile(envFile, 'utf8') : ''
  const line = `${envName}=${answer.agentKey}`
  const kept = current.split('\n').filter(l => l && !l.startsWith(`${envName}=`))
  await writeFile(envFile, `${[...kept, line].join('\n')}\n`, { mode: 0o600 })

  const configFile = join(home, 'config.yaml')
  const doc = parseDocument(existsSync(configFile) ? await readFile(configFile, 'utf8') : '')
  if (doc.errors.length) throw new Error(`${configFile} is not valid YAML: ${doc.errors[0].message}`)
  const server = serverName(answer.merchantName)
  if (state.mcpUrl) {
    doc.setIn(['mcp_servers', server], doc.createNode({
      url: state.mcpUrl,
      headers: { Authorization: `Bearer \${${envName}}` },
      timeout: 120,
    }))
  }
  if (state.modelUrl) {
    doc.setIn(['providers', server], doc.createNode({
      api: state.modelUrl,
      transport: 'anthropic_messages',
      key_env: envName,
      default_model: state.model,
    }))
  }
  await writeFile(configFile, doc.toString())
  return { envFile, envName, configFile, server }
}

export const hermes = {
  name: 'hermes',
  client: 'hermes',
  displayName: 'Hermes',
  /** Once `connect` is approved: set Hermes up and say what changed. */
  async connected(env, state, answer) {
    const saved = await saveForHermes(env, state, answer)
    return [
      `The agent key is saved in ${saved.envFile} as ${saved.envName} (not shown here).`,
      ...(state.mcpUrl
        ? [
            `Hermes has a new MCP server "${saved.server}" at ${state.mcpUrl}.`,
            `Run /reload-mcp to load its tools (Hermes also picks it up by itself within about 30 seconds).`,
          ]
        : []),
      ...(state.modelUrl
        ? [
            `Hermes has a new model provider "${saved.server}" at ${state.modelUrl}, paid with the key.`,
            `A session keeps the providers it started with, so start a new one on it:`,
            `  hermes chat --model custom:${saved.server}:${state.model}`,
          ]
        : []),
    ]
  },  /**
   * Hermes reads its model providers from its own config, so the key and the
   * merchant's model API go there (as `connect` puts them), and the
   * session starts on that provider.
   */
  async launch({ env, providerRef, agentKey, merchantName, modelUrl, model, args }) {
    const saved = await saveForHermes(env, { modelUrl, model }, { providerRef, agentKey, merchantName })
    return {
      command: 'hermes',
      args: ['chat', '--model', `custom:${saved.server}:${model}`, ...args],
      env,
    }
  },
}
