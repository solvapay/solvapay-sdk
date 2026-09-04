#!/usr/bin/env node
/**
 * Browser symbol audit (§7.1): declared allowlist, measured pkg/browser
 * exports, and runtime/browser-web.js re-exports must be the same set.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const rustRoot = resolve(pkgRoot, '../..')

const FORBIDDEN_SEMANTIC = [
  'verifyWebhook',
  'verify_webhook',
  'napiVersion',
  'createSolvaPayClient',
  'createPaymentIntent',
  'processPaymentIntent',
  'checkLimits',
  'trackUsage',
  'solvapayCall',
  'invokePayableNext',
]

const BINDGEN_RUNTIME = new Set(['initSync', 'init', '__wbg_init'])
const WRAPPER_EXPORTS = new Set(['initSync', 'ready', 'ensureReadySync'])

/** Internal wasm-bindgen / allocator exports may match these patterns. */
const INTERNAL_EXPORT_PATTERNS = [
  /^__wbindgen/,
  /^__wbg_/,
  /^__wasm/,
  /^memory$/,
  /^__data_end$/,
  /^__heap_base$/,
  /^__tls_/,
]

function isInternalExport(name) {
  return INTERNAL_EXPORT_PATTERNS.some(re => re.test(name))
}

function fail(msg) {
  console.error(`browser-symbol-audit: ${msg}`)
  process.exit(1)
}

function parseDtsExports(source) {
  const names = new Set()
  for (const raw of source.split('\n')) {
    const fn = raw.match(/^export function (\w+)/)
    if (fn) {
      names.add(fn[1])
      continue
    }
    const cnst = raw.match(/^export const (\w+)/)
    if (cnst) {
      names.add(cnst[1])
    }
  }
  for (const runtime of BINDGEN_RUNTIME) {
    names.delete(runtime)
  }
  return names
}

function parseNamedExportBlock(source) {
  const names = new Set()
  const match = source.match(/export \{([\s\S]*?)\}/)
  if (!match) {
    fail('runtime/browser-web.js is missing an explicit export { … } block')
  }
  for (const part of match[1].split(',')) {
    const name = part.trim()
    if (name) names.add(name)
  }
  for (const wrapper of WRAPPER_EXPORTS) {
    names.delete(wrapper)
  }
  return names
}

function formatSet(set) {
  return [...set].sort().join(', ')
}

function assertEqualSets(left, right, leftLabel, rightLabel) {
  const missing = [...left].filter(name => !right.has(name)).sort()
  const extra = [...right].filter(name => !left.has(name)).sort()
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${leftLabel} ↔ ${rightLabel} mismatch` +
        (missing.length > 0 ? `\n  missing from ${rightLabel}: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `\n  extra in ${rightLabel}: ${extra.join(', ')}` : ''),
    )
  }
}

const allowlistPath = join(pkgRoot, 'browser-symbols.generated.json')
if (!existsSync(allowlistPath)) {
  fail('browser-symbols.generated.json missing — run `pnpm gen`')
}
const allowlist = new Set(JSON.parse(readFileSync(allowlistPath, 'utf8')).browserSafe)
if (allowlist.size === 0) {
  fail('generated browserSafe allowlist is empty')
}

const browserWasm = join(pkgRoot, 'pkg/browser/solvapay_wasm_bg.wasm')
const browserGlue = join(pkgRoot, 'pkg/browser/solvapay_wasm.js')
const browserDts = join(pkgRoot, 'pkg/browser/solvapay_wasm.d.ts')

if (!existsSync(browserWasm) || !existsSync(browserGlue) || !existsSync(browserDts)) {
  fail('browser artifacts missing — run `pnpm build` in sdks/wasm first')
}

const bytes = readFileSync(browserWasm)
const mod = new WebAssembly.Module(bytes)
const rawExports = WebAssembly.Module.exports(mod).map(e => e.name)

for (const name of rawExports) {
  if (isInternalExport(name)) continue
  const semantic = name.replace(/^solvapay_wasm_/, '')
  if (FORBIDDEN_SEMANTIC.some(f => name.includes(f) || semantic.includes(f))) {
    fail(`forbidden raw export: ${name}`)
  }
}

const glue = readFileSync(browserGlue, 'utf8')
const dts = readFileSync(browserDts, 'utf8')
for (const forbidden of FORBIDDEN_SEMANTIC) {
  if (glue.includes(forbidden) || dts.includes(forbidden)) {
    fail(`forbidden symbol in generated glue/d.ts: ${forbidden}`)
  }
}

const runtimeBrowser = readFileSync(join(pkgRoot, 'runtime/browser-web.js'), 'utf8')
const runtimeCode = runtimeBrowser
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
if (/\bverifyWebhook\b/.test(runtimeCode) || /\bverify_webhook\b/.test(runtimeCode)) {
  fail('runtime/browser-web.js must not reference webhook verification exports')
}
if (!runtimeCode.includes('wasmVersion')) {
  fail('runtime/browser-web.js must export wasmVersion')
}

const dtsExports = parseDtsExports(dts)
const runtimeExports = parseNamedExportBlock(runtimeBrowser)
assertEqualSets(allowlist, dtsExports, 'declared allowlist', 'pkg/browser d.ts')
assertEqualSets(allowlist, runtimeExports, 'declared allowlist', 'runtime/browser-web.js')

const tree = spawnSync(
  'cargo',
  [
    'tree',
    '-p',
    'solvapay-wasm',
    '--target',
    'wasm32-unknown-unknown',
    '--no-default-features',
    '--features',
    'browser',
    '--edges',
    'normal',
  ],
  { cwd: rustRoot, encoding: 'utf8' },
)
if (tree.status !== 0) {
  fail(`cargo tree failed:\n${tree.stderr}`)
}
const lower = tree.stdout.toLowerCase()
for (const banned of ['solvapay-transport', 'reqwest', 'tokio', 'rsa', 'p256']) {
  if (lower.includes(banned)) {
    fail(`browser dependency graph must not include ${banned}`)
  }
}

console.log('OK: browser symbol audit passed')
console.log(`  raw exports: ${rawExports.length}`)
console.log(`  semantic allowlist: ${formatSet(allowlist)}`)
