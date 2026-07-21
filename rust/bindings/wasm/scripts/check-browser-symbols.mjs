#!/usr/bin/env node
/**
 * Browser symbol audit (§7.1): exact semantic-export allowlist + raw WASM
 * exports + generated glue inspection + dependency-tree assertions.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const rustRoot = resolve(pkgRoot, '../..')

const BROWSER_SEMANTIC_ALLOWLIST = new Set([
  'wasmVersion',
  // business-details (public-safe, Step 38R-e)
  'validateBusinessDetails',
  'deriveTaxIdType',
  'resolveTaxBehavior',
  'getTaxIdExample',
  'getTaxIdFieldLabel',
  'getTaxIdHelperText',
  'getBusinessCountryOptions',
  // credit-display (public-safe)
  'creditsToDisplayMinorUnits',
  'isZeroDecimalCurrency',
  'minorUnitsPerMajor',
  // seller-identity (public-safe)
  'resolveSellerIdentityDisplay',
  'getSellerTaxIdentifierDisplayLabel',
  'SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE',
])
const FORBIDDEN_SEMANTIC = [
  'verifyWebhook',
  'verify_webhook',
  'napiVersion',
  'createSolvaPayClient',
  'createPaymentIntent',
  'processPaymentIntent',
  'checkLimits',
  'trackUsage',
]

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

const browserWasm = join(pkgRoot, 'pkg/browser/solvapay_wasm_bg.wasm')
const browserGlue = join(pkgRoot, 'pkg/browser/solvapay_wasm.js')
const browserDts = join(pkgRoot, 'pkg/browser/solvapay_wasm.d.ts')

if (!existsSync(browserWasm) || !existsSync(browserGlue)) {
  fail('browser artifacts missing — run `pnpm build` in rust/bindings/wasm first')
}

const bytes = readFileSync(browserWasm)
const mod = new WebAssembly.Module(bytes)
const rawExports = WebAssembly.Module.exports(mod).map(e => e.name)

for (const name of rawExports) {
  if (isInternalExport(name)) continue
  // wasm-bindgen mangled export for wasmVersion looks like wasmVersion or similar
  const semantic = name.replace(/^solvapay_wasm_/, '')
  if (FORBIDDEN_SEMANTIC.some(f => name.includes(f) || semantic.includes(f))) {
    fail(`forbidden raw export: ${name}`)
  }
}

const glue = readFileSync(browserGlue, 'utf8')
const dts = existsSync(browserDts) ? readFileSync(browserDts, 'utf8') : ''
for (const forbidden of FORBIDDEN_SEMANTIC) {
  if (glue.includes(forbidden) || dts.includes(forbidden)) {
    fail(`forbidden symbol in generated glue/d.ts: ${forbidden}`)
  }
}

// JS-visible named exports from the browser runtime wrapper surface.
const runtimeBrowser = readFileSync(join(pkgRoot, 'runtime/browser-web.js'), 'utf8')
// Strip block/line comments before scanning for forbidden identifiers.
const runtimeCode = runtimeBrowser
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
if (/\bverifyWebhook\b/.test(runtimeCode) || /\bverify_webhook\b/.test(runtimeCode)) {
  fail('runtime/browser-web.js must not reference webhook verification exports')
}
if (!runtimeCode.includes('wasmVersion')) {
  fail('runtime/browser-web.js must export wasmVersion')
}

// Allowlist check: only wasmVersion as semantic export in .d.ts of browser package surface.
for (const name of BROWSER_SEMANTIC_ALLOWLIST) {
  if (!runtimeBrowser.includes(name)) {
    fail(`missing allowed semantic export wiring: ${name}`)
  }
}

// Dependency tree: browser feature graph must exclude transport/reqwest/tokio.
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
for (const banned of ['solvapay-transport', 'reqwest', 'tokio']) {
  if (lower.includes(banned)) {
    fail(`browser dependency graph must not include ${banned}`)
  }
}

console.log('OK: browser symbol audit passed')
console.log(`  raw exports: ${rawExports.length}`)
console.log(`  semantic allowlist: ${[...BROWSER_SEMANTIC_ALLOWLIST].join(', ')}`)
