// Claude Code: a launch puts everything into the child's environment and flags
// for that launch only. The one thing written to the user's own Claude config
// is a merchant's MCP server, and only when `connect --add-mcp` asks for it.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentDir, keyPath } from '../key-store.mjs'
import { serverName } from './hermes.mjs'

/** Claude Code would send these beside the agent key, and the merchant may read them first. */
const DROPPED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CONFIG_DIR',
]

const CLEARED_KEY = JSON.stringify({ env: { ANTHROPIC_API_KEY: '' } })

export const claudeCode = {
  name: 'claude',
  client: 'claude',
  displayName: 'Claude Code',
  /** Once `connect` is approved: add the merchant's MCP server when asked, else say how to start a session. */
  async connected(env, state, answer, { exec, npx }) {
    if (state.addMcp) {
      const added = await addToClaudeCode(env, { ...answer, mcpUrl: state.mcpUrl }, exec)
      return mcpAddedLines(added, state.mcpUrl)
    }
    const addMcp = `add its MCP server to Claude Code, paying with the same key: run the same command with --add-mcp.`
    // `launch` runs Claude Code on the merchant's model API, so it is offered only when there is one.
    if (!state.modelUrl && !state.modelApi) return state.mcpUrl ? [`To use it, ${addMcp}`] : []
    return [
      `Start Claude Code paying with it:`,
      `  ${npx} launch claude ${answer.providerRef}${state.modelUrl ? ` --model-url ${state.modelUrl} --model ${state.model}` : ''}`,
      ...(state.mcpUrl ? [`Or ${addMcp}`] : []),
    ]
  },
  /**
   * The command, arguments and environment to start Claude Code on the
   * merchant's Anthropic-compatible API, paying with the agent key.
   */
  async launch({ env, providerRef, agentKey, modelUrl, model, args }) {
    const configDir = agentDir(env, 'claude', providerRef)
    await skipFirstRunSetup(configDir)
    const child = Object.fromEntries(
      Object.entries(env).filter(([name]) => !DROPPED.includes(name)),
    )
    return {
      command: 'claude',
      // The user's own settings can set ANTHROPIC_API_KEY, which beats the agent key. Started
      // from the home folder, ~/.claude/settings.json is also the project's, so --settings
      // (which outranks project and local) clears the key as well.
      args: ['--setting-sources', 'project,local', '--settings', CLEARED_KEY, ...args],
      env: {
        ...child,
        ANTHROPIC_BASE_URL: modelUrl,
        ANTHROPIC_AUTH_TOKEN: agentKey,
        ANTHROPIC_MODEL: model,
        // Background calls (titles, summaries) would otherwise ask for a model the merchant may not serve.
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        ANTHROPIC_SMALL_FAST_MODEL: model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // A user's own login and config made calls go out with another key (1 Nov runs).
        CLAUDE_CONFIG_DIR: configDir,
      },
    }
  },
}

/**
 * The shell command Claude Code runs on each connection to the merchant's MCP
 * server (its `headersHelper`): reads the saved key and prints the
 * `Authorization` header as JSON, so the key never sits in Claude's config.
 * Node by absolute path and no npx, because Claude Code gives a helper 10
 * seconds. A missing key file makes it exit non-zero and the server fail to
 * connect, which `/mcp` shows.
 */
export function headersHelper(env, providerRef) {
  const file = JSON.stringify(keyPath(env, providerRef))
  const code =
    `const k=JSON.parse(require('fs').readFileSync(${file},'utf8')).agentKey;` +
    `if(!k)throw new Error('No agent key in '+${file});` +
    `process.stdout.write(JSON.stringify({Authorization:'Bearer '+k}))`
  return `${shellQuote(process.execPath)} -e ${shellQuote(code)}`
}

function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * Adds the merchant's MCP server to Claude Code at user scope, through
 * Claude Code's own `claude mcp add-json`, authenticated by `headersHelper`.
 * A server of that name this connect added before (its helper reads this
 * merchant's key) is kept, or updated when its URL or helper changed (another
 * MCP URL, another Node path); one it did not add is refused.
 */
export async function addToClaudeCode(env, { providerRef, merchantName, mcpUrl }, exec) {
  if (!mcpUrl) throw new Error(`${providerRef} has no MCP server to add to Claude Code`)
  const name = serverName(merchantName)
  const helper = headersHelper(env, providerRef)
  const config = JSON.stringify({ type: 'http', url: mcpUrl, headersHelper: helper })
  const add = () => exec('claude', ['mcp', 'add-json', name, config, '--scope', 'user'], env)

  let result = await add()
  if (result.code === 0) return { name, status: 'added' }
  if (!/already exists/i.test(result.output)) {
    throw new Error(
      `claude mcp add-json ${name} failed (exit ${result.code}): ${result.output.trim()}`,
    )
  }
  const existing = await userServer(env, name)
  const ours =
    typeof existing?.headersHelper === 'string' &&
    existing.headersHelper.includes(keyPath(env, providerRef))
  if (!ours) {
    throw new Error(
      `Claude Code already has an MCP server called "${name}" that solvapay connect did not add. ` +
        `Remove it with \`claude mcp remove ${name} -s user\` if it is no longer needed, then run the same command again.`,
    )
  }
  if (existing.url === mcpUrl && existing.headersHelper === helper)
    return { name, status: 'unchanged' }
  const removed = await exec('claude', ['mcp', 'remove', name, '--scope', 'user'], env)
  if (removed.code !== 0) {
    throw new Error(
      `claude mcp remove ${name} failed (exit ${removed.code}): ${removed.output.trim()}`,
    )
  }
  result = await add()
  if (result.code !== 0) {
    throw new Error(
      `claude mcp add-json ${name} failed (exit ${result.code}): ${result.output.trim()}`,
    )
  }
  return { name, status: 'updated' }
}

/** The user-scope server of this name in Claude Code's config, or null; read only, to recognise one this connect added. */
async function userServer(env, name) {
  const file = env.CLAUDE_CONFIG_DIR
    ? join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : join(homedir(), '.claude.json')
  if (!existsSync(file)) return null
  return JSON.parse(await readFile(file, 'utf8')).mcpServers?.[name] ?? null
}

export function mcpAddedLines({ name, status }, mcpUrl) {
  return [
    {
      added: `Claude Code has a new MCP server "${name}" at ${mcpUrl} (user scope), paying with this key.`,
      updated: `Claude Code's MCP server "${name}" is updated: it is at ${mcpUrl}, paying with this key.`,
      unchanged: `Claude Code already has the MCP server "${name}" at ${mcpUrl}, paying with this key.`,
    }[status],
    // A running Claude Code session does not reread its config, not even in /mcp (tested on 2.1.286).
    `Start a new Claude Code session to use it; one already open will not see it. Check it with: claude mcp get ${name}`,
  ]
}

/**
 * Claude Code treats its own config folder as a first run and asks for a
 * theme and the like before anything else. Marks that setup done, keeping
 * whatever Claude Code saved there. The folder trust question still comes:
 * that one is the user's to answer.
 */
async function skipFirstRunSetup(configDir) {
  const file = join(configDir, '.claude.json')
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const saved = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {}
  if (saved.hasCompletedOnboarding === true) return
  await writeFile(
    file,
    `${JSON.stringify({ ...saved, hasCompletedOnboarding: true }, null, 2)}\n`,
    { mode: 0o600 },
  )
  await chmod(file, 0o600)
}
