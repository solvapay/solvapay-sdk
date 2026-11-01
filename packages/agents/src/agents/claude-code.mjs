// Claude Code: everything goes into the child's environment and flags for
// that launch only; nothing is written to the user's own Claude config.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { agentDir } from '../key-store.mjs'

/** Claude Code would send these beside the agent key, and the merchant may read them first. */
const DROPPED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR']

const CLEARED_KEY = JSON.stringify({ env: { ANTHROPIC_API_KEY: '' } })

export const claudeCode = {
  name: 'claude',
  client: 'claude-code',
  displayName: 'Claude Code',
  async connected(env, state, answer) {
    return [
      `Start Claude Code paying with it:`,
      `  npx @solvapay/agents launch claude ${answer.providerRef}${state.modelUrl ? ` --model-url ${state.modelUrl} --model ${state.model}` : ''}`,
    ]
  },
  /**
   * The command, arguments and environment to start Claude Code on the
   * merchant's Anthropic-compatible API, paying with the agent key.
   */
  async launch({ env, providerRef, agentKey, modelUrl, model, args }) {
    const configDir = agentDir(env, 'claude', providerRef)
    await skipFirstRunSetup(configDir)
    const child = Object.fromEntries(Object.entries(env).filter(([name]) => !DROPPED.includes(name)))
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
  await writeFile(file, `${JSON.stringify({ ...saved, hasCompletedOnboarding: true }, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}
