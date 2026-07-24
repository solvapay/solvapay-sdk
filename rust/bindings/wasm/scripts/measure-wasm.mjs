#!/usr/bin/env node
/**
 * Deterministic gzip size + cold-start measurement for edge/browser WASM.
 *
 * --check  (default in CI): compare against budgets.json; never rewrite
 * --record : write observed baselines into budgets.json (explicit only)
 */
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const budgetsPath = join(pkgRoot, 'budgets.json')
const record = process.argv.includes('--record')
const check = !record || process.argv.includes('--check')

const SAMPLES = 7
const REGRESSION_PCT = 10

function fail(msg) {
  console.error(`measure-wasm: ${msg}`)
  process.exit(1)
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function mad(values, med) {
  const deviations = values.map(v => Math.abs(v - med))
  return median(deviations)
}

function measureBytes(profile) {
  const wasmPath = join(pkgRoot, `pkg/${profile}/solvapay_wasm_bg.wasm`)
  if (!existsSync(wasmPath)) fail(`missing ${wasmPath}`)
  const raw = readFileSync(wasmPath)
  const gzip = gzipSync(raw, { level: 9 })
  return { rawBytes: raw.length, gzipBytes: gzip.length }
}

function coldStartMs(profile, mode) {
  // Fresh child process per sample — discard warm reuse by design.
  const script =
    mode === 'browser'
      ? `
import { pathToFileURL } from 'node:url';
const start = performance.now();
const mod = await import(${JSON.stringify(pathToFileURL(join(pkgRoot, 'runtime/browser-node.js')).href)});
await mod.ready();
mod.wasmVersion();
const ms = performance.now() - start;
process.stdout.write(String(ms));
`
      : `
import { pathToFileURL } from 'node:url';
const FIXTURE_BODY = ${JSON.stringify(
        JSON.stringify({
          type: 'purchase.created',
          id: 'evt_fixture_1',
          created: 1782864000,
          api_version: '2025-10-01',
          data: { object: { id: 'pur_fixture_1' }, previous_attributes: null },
          livemode: false,
          request: { id: null, idempotency_key: null },
        }),
      )};
const start = performance.now();
const mod = await import(${JSON.stringify(pathToFileURL(join(pkgRoot, 'runtime/node.js')).href)});
await mod.ready();
mod.verifyWebhook(
  FIXTURE_BODY,
  't=1782864000,v1=04834cba2241fe998a4fb5b8bb4632b2c2e18a3e330dba1905f62b365521ca82',
  'whsec_test_fixture_secret',
  1782864000,
);
const ms = performance.now() - start;
process.stdout.write(String(ms));
`

  const samples = []
  for (let i = 0; i < SAMPLES; i++) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      cwd: pkgRoot,
    })
    if (result.status !== 0) {
      fail(`cold-start sample failed (${profile}/${mode}): ${result.stderr}`)
    }
    const ms = Number(result.stdout.trim())
    if (!Number.isFinite(ms) || ms < 0) {
      fail(`malformed cold-start sample: ${result.stdout}`)
    }
    samples.push(ms)
  }
  if (samples.length < SAMPLES) fail('insufficient cold-start samples')
  const med = median(samples)
  return { medianMs: med, madMs: mad(samples, med), samples }
}

function rustcVersion() {
  const r = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : 'unknown'
}

function wasmBindgenVersion() {
  const r = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : 'unknown'
}

const browserSize = measureBytes('browser')
const edgeSize = measureBytes('edge')
const browserCold = coldStartMs('browser', 'browser')
const edgeCold = coldStartMs('edge', 'edge')

const observed = {
  version: 1,
  measurement: {
    gzipLevel: 9,
    browserColdStart:
      'fresh Node process: import runtime/browser-node.js → ready() → wasmVersion()',
    edgeColdStart:
      'fresh Node process: import runtime/node.js → ready() → verifyWebhook(frozen accept fixture)',
    samplesPerMetric: SAMPLES,
    statistic: 'median',
    spread: 'median absolute deviation (MAD)',
    regressionThresholdPct: REGRESSION_PCT,
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    rustc: rustcVersion(),
    wasmBindgen: wasmBindgenVersion(),
    binaryen: '131.0.0',
    recordedAt: new Date().toISOString(),
  },
  baselines: {
    browser: {
      rawBytes: browserSize.rawBytes,
      gzipBytes: browserSize.gzipBytes,
      coldStartMedianMs: browserCold.medianMs,
    },
    edge: {
      rawBytes: edgeSize.rawBytes,
      gzipBytes: edgeSize.gzipBytes,
      coldStartMedianMs: edgeCold.medianMs,
      note: 'diagnostic only — §7.8 mandatory budget is browser',
    },
  },
  // Max allowed = baseline * 1.10 (enforced on check against stored baselines)
  maxAllowed: null,
}

function withMax(baselines) {
  return {
    browser: {
      gzipBytes: Math.floor(baselines.browser.gzipBytes * (1 + REGRESSION_PCT / 100)),
      coldStartMedianMs:
        baselines.browser.coldStartMedianMs * (1 + REGRESSION_PCT / 100),
    },
    edge: {
      gzipBytes: Math.floor(baselines.edge.gzipBytes * (1 + REGRESSION_PCT / 100)),
      coldStartMedianMs: baselines.edge.coldStartMedianMs * (1 + REGRESSION_PCT / 100),
    },
  }
}

observed.maxAllowed = withMax(observed.baselines)

console.log('Observed:')
console.log(JSON.stringify(observed.baselines, null, 2))
console.log('Cold-start MAD (browser/edge):', browserCold.madMs, edgeCold.madMs)

if (record) {
  writeFileSync(budgetsPath, `${JSON.stringify(observed, null, 2)}\n`)
  console.log(`Wrote ${budgetsPath}`)
}

if (check && !record) {
  if (!existsSync(budgetsPath)) {
    fail('budgets.json missing — run with --record once to establish baselines')
  }
  const budget = JSON.parse(readFileSync(budgetsPath, 'utf8'))
  const max = budget.maxAllowed ?? withMax(budget.baselines)

  function checkMetric(label, value, limit) {
    if (value > limit) {
      fail(
        `${label} regression: observed ${value} > maxAllowed ${limit} (>${REGRESSION_PCT}% over baseline). Explicit review + --record required.`,
      )
    }
  }

  checkMetric('browser.gzipBytes', browserSize.gzipBytes, max.browser.gzipBytes)
  checkMetric(
    'browser.coldStartMedianMs',
    browserCold.medianMs,
    max.browser.coldStartMedianMs,
  )
  // Edge diagnostics: warn-style hard fail same threshold so CI catches blowups.
  checkMetric('edge.gzipBytes', edgeSize.gzipBytes, max.edge.gzipBytes)
  checkMetric('edge.coldStartMedianMs', edgeCold.medianMs, max.edge.coldStartMedianMs)

  console.log('OK: size/cold-start budgets within 10% of recorded baselines')
}
