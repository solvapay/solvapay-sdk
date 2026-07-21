#!/usr/bin/env node
/**
 * Consumer-side smoke executed inside a fresh temp project after `npm install`
 * of packed tarballs (Step 39). Imports public `@solvapay/server` only.
 *
 * Resolution is rooted at CLEAN_INSTALL_CONSUMER_ROOT (the temp project), never
 * the monorepo — this script may be copied into that tree before execution.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  WEBHOOK_SMOKE_EVENT_ID,
  WEBHOOK_SMOKE_EVENT_TYPE,
  WEBHOOK_SMOKE_BODY,
  WEBHOOK_SMOKE_SECRET,
  freshWebhookSmokeSigned,
} from './webhook-smoke-fixture.mjs'
import {
  LOADER_PACKAGE_NAME,
  NATIVE_TARGETS,
  WASI_TARGET,
} from './targets.mjs'

const consumerRoot = process.env.CLEAN_INSTALL_CONSUMER_ROOT
  ? resolve(process.env.CLEAN_INSTALL_CONSUMER_ROOT)
  : process.cwd()

const require = createRequire(join(consumerRoot, 'package.json'))

const mode = process.env.CLEAN_INSTALL_MODE
const expectedTarget = process.env.CLEAN_INSTALL_EXPECTED_TARGET
const expectedPackage = process.env.CLEAN_INSTALL_EXPECTED_PACKAGE
const expectedPlatform = process.env.CLEAN_INSTALL_EXPECTED_PLATFORM
const expectedArch = process.env.CLEAN_INSTALL_EXPECTED_ARCH
const expectedLibc = process.env.CLEAN_INSTALL_EXPECTED_LIBC || null
const expectedNodeMajor = process.env.CLEAN_INSTALL_EXPECTED_NODE_MAJOR

function fail(message) {
  console.error(`clean-install-consumer FAIL: ${message}`)
  process.exit(1)
}

function assertEnv(name, value) {
  if (!value) fail(`missing required env ${name}`)
}

/**
 * @param {string} packageName
 * @returns {string} absolute path to package.json
 */
function resolveInstalledPackageJson(packageName) {
  const direct = join(consumerRoot, 'node_modules', ...packageName.split('/'), 'package.json')
  if (existsSync(direct)) return direct
  try {
    const main = require.resolve(packageName)
    let dir = dirname(main)
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8'))
        if (pkg.name === packageName) return candidate
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // fall through
  }
  throw new Error(`Unable to resolve installed package ${packageName} under ${consumerRoot}`)
}

assertEnv('CLEAN_INSTALL_MODE', mode)
assertEnv('CLEAN_INSTALL_EXPECTED_TARGET', expectedTarget)
assertEnv('CLEAN_INSTALL_EXPECTED_PACKAGE', expectedPackage)
assertEnv('CLEAN_INSTALL_EXPECTED_PLATFORM', expectedPlatform)
assertEnv('CLEAN_INSTALL_EXPECTED_ARCH', expectedArch)
assertEnv('CLEAN_INSTALL_EXPECTED_NODE_MAJOR', expectedNodeMajor)

if (mode !== 'native' && mode !== 'wasi') {
  fail(`invalid CLEAN_INSTALL_MODE=${mode}`)
}

const nodeMajor = String(process.versions.node.split('.')[0])
if (nodeMajor !== expectedNodeMajor) {
  fail(`Node major mismatch: expected ${expectedNodeMajor}, got ${process.version}`)
}

if (mode === 'native') {
  if (process.platform !== expectedPlatform) {
    fail(`platform mismatch: expected ${expectedPlatform}, got ${process.platform}`)
  }
  if (process.arch !== expectedArch) {
    fail(`arch mismatch: expected ${expectedArch}, got ${process.arch}`)
  }
  if (expectedLibc) {
    const report = process.report?.getReport?.()
    const glibc = report?.header?.glibcVersionRuntime
    const actualLibc = typeof glibc === 'string' && glibc.length > 0 ? 'glibc' : 'musl'
    if (actualLibc !== expectedLibc) {
      fail(`libc mismatch: expected ${expectedLibc}, got ${actualLibc}`)
    }
  }
  if (process.env.NAPI_RS_FORCE_WASI) {
    fail('native mode must not set NAPI_RS_FORCE_WASI')
  }
} else if (process.env.NAPI_RS_FORCE_WASI !== 'error') {
  fail('wasi mode requires NAPI_RS_FORCE_WASI=error')
}

if (process.env.SOLVAPAY_IMPL !== 'rust') {
  fail('SOLVAPAY_IMPL must be rust')
}

let serverPkgPath
let loaderPkgPath
let targetPkgPath
try {
  serverPkgPath = resolveInstalledPackageJson('@solvapay/server')
  loaderPkgPath = resolveInstalledPackageJson(LOADER_PACKAGE_NAME)
  targetPkgPath = resolveInstalledPackageJson(expectedPackage)
} catch (err) {
  fail(`package resolution failed: ${err instanceof Error ? err.message : String(err)}`)
}

assert.ok(
  serverPkgPath.startsWith(consumerRoot),
  `server package resolved outside consumer tree: ${serverPkgPath}`,
)
assert.ok(
  loaderPkgPath.startsWith(consumerRoot),
  `loader package resolved outside consumer tree: ${loaderPkgPath}`,
)
assert.ok(
  targetPkgPath.startsWith(consumerRoot),
  `target package resolved outside consumer tree: ${targetPkgPath}`,
)

if (mode === 'native') {
  if (existsSync(join(consumerRoot, 'node_modules', ...WASI_TARGET.packageName.split('/')))) {
    fail(`${WASI_TARGET.packageName} must be absent in native mode`)
  }
  for (const t of NATIVE_TARGETS) {
    if (t.packageName === expectedPackage) continue
    if (existsSync(join(consumerRoot, 'node_modules', ...t.packageName.split('/')))) {
      fail(`unexpected native package installed: ${t.packageName}`)
    }
  }
} else {
  for (const t of NATIVE_TARGETS) {
    if (existsSync(join(consumerRoot, 'node_modules', ...t.packageName.split('/')))) {
      fail(`native package must be absent in wasi mode: ${t.packageName}`)
    }
  }
  const nodeFiles = findFiles(consumerRoot, name => name.endsWith('.node'))
  if (nodeFiles.length > 0) {
    fail(`.node files must be absent in wasi mode: ${nodeFiles.join(', ')}`)
  }
}

const serverEntry = require.resolve('@solvapay/server')
const { verifyWebhook } = await import(pathToFileURL(serverEntry).href)
const signed = freshWebhookSmokeSigned()
const event = verifyWebhook({
  body: signed.body,
  signature: signed.signature,
  secret: signed.secret,
})

assert.equal(event.type, WEBHOOK_SMOKE_EVENT_TYPE)
assert.equal(event.id, WEBHOOK_SMOKE_EVENT_ID)

const badSig = `t=${signed.t},v1=${'ff'.repeat(32)}`
let rejected = false
try {
  verifyWebhook({ body: WEBHOOK_SMOKE_BODY, signature: badSig, secret: WEBHOOK_SMOKE_SECRET })
} catch {
  rejected = true
}
assert.ok(rejected, 'expected bad signature to throw')

const libcLabel = expectedLibc ?? 'n/a'
console.log(
  `CLEAN_INSTALL_OK mode=${mode} node=${nodeMajor} os=${process.platform} arch=${process.arch} libc=${libcLabel} target=${expectedPackage} event=${event.id}`,
)

/**
 * @param {string} root
 * @param {(name: string) => boolean} pred
 * @returns {string[]}
 */
function findFiles(root, pred) {
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir || !existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (entry === '.git') continue
        stack.push(full)
      } else if (pred(entry)) {
        out.push(full)
      }
    }
  }
  return out
}
