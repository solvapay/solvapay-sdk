// Where agent keys live on this machine: one file per merchant at
// `~/.solvapay/agents/<providerRef>.json`, mode 600. A key here pays that
// merchant until its owner revokes it, so nothing in this module prints it.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** `SOLVAPAY_HOME`, or `~/.solvapay`. */
export function solvapayHome(env) {
  return env.SOLVAPAY_HOME || join(homedir(), '.solvapay')
}

function agentsDir(env) {
  return join(solvapayHome(env), 'agents')
}

function checkRef(providerRef) {
  if (!/^[A-Za-z0-9_-]+$/.test(providerRef))
    throw new Error(`Not a merchant reference: ${providerRef}`)
}

export function keyPath(env, providerRef) {
  checkRef(providerRef)
  return join(agentsDir(env), `${providerRef}.json`)
}

/** A connect request waiting for its owner, kept until a later `connect` claims it or finds it dead. */
export function pendingPath(env, providerRef) {
  checkRef(providerRef)
  return join(agentsDir(env), 'pending', `${providerRef}.json`)
}

/** A folder an agent host can keep its own config in, apart from the user's. */
export function agentDir(env, agent, providerRef) {
  checkRef(providerRef)
  return join(agentsDir(env), agent, providerRef)
}

async function writePrivate(path, value) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  // `mode` only applies when the file is created.
  await chmod(path, 0o600)
}

/** Saves the merchant's key, replacing any earlier one: one key per merchant. */
export async function saveKey(env, saved) {
  const { providerRef, agentKey, agentRef, merchantName, api } = saved
  if (!agentKey) throw new Error(`No agent key to save for ${providerRef}`)
  const path = keyPath(env, providerRef)
  await writePrivate(path, {
    providerRef,
    merchantName,
    agentRef,
    api,
    agentKey,
    savedAt: new Date().toISOString(),
  })
  return path
}

/** The saved key for this merchant, or null when there is none. */
export async function readKey(env, providerRef) {
  const path = keyPath(env, providerRef)
  if (!existsSync(path)) return null
  const saved = JSON.parse(await readFile(path, 'utf8'))
  if (typeof saved.agentKey !== 'string' || !saved.agentKey)
    throw new Error(`${path} has no agent key`)
  return saved
}

export async function savePending(env, providerRef, state) {
  await writePrivate(pendingPath(env, providerRef), state)
}

export async function readPending(env, providerRef) {
  const path = pendingPath(env, providerRef)
  return existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null
}

export async function dropPending(env, providerRef) {
  await rm(pendingPath(env, providerRef), { force: true })
}
