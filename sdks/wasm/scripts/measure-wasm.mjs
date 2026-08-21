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

/** Total child-process samples collected per profile (including warmups). */
const SAMPLES = 15
/** Discard the first N samples — shared runners are noisy on cold boot. */
const WARMUP_DISCARD = 3
/** Byte budgets stay strict. */
const BYTE_REGRESSION_PCT = 10
/**
 * Cold start is bounded below by real work and unbounded above by runner
 * contention, so it gets a wider tolerance than byte metrics.
 */
const COLD_START_REGRESSION_PCT = 50
/** Lower-tail statistic for cold start (stable under upward noise). */
const COLD_START_PERCENTILE = 0.2

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

/** Linear-interpolation percentile; `p` in [0, 1]. */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
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
  const measured = samples.slice(WARMUP_DISCARD)
  if (measured.length < 3) fail('insufficient cold-start samples after warmup discard')
  const coldMs = percentile(measured, COLD_START_PERCENTILE)
  const med = median(measured)
  return {
    coldStartMs: coldMs,
    medianMs: med,
    madMs: mad(measured, med),
    samples: measured,
    allSamples: samples,
  }
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
    warmupDiscard: WARMUP_DISCARD,
    statistic: `percentile p${Math.round(COLD_START_PERCENTILE * 100)} (cold start); exact (bytes)`,
    spread: 'median absolute deviation (MAD) of post-warmup samples (diagnostic)',
    byteRegressionThresholdPct: BYTE_REGRESSION_PCT,
    coldStartRegressionThresholdPct: COLD_START_REGRESSION_PCT,
    // Back-compat alias used by older readers of budgets.json.
    regressionThresholdPct: BYTE_REGRESSION_PCT,
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
      coldStartMs: browserCold.coldStartMs,
    },
    edge: {
      rawBytes: edgeSize.rawBytes,
      gzipBytes: edgeSize.gzipBytes,
      coldStartMs: edgeCold.coldStartMs,
      note: 'CI-enforced alongside browser; §7.8 headline metric remains browser',
    },
  },
  // Max allowed computed per-metric (bytes vs cold-start tolerances differ).
  maxAllowed: null,
}

function withMax(baselines) {
  return {
    browser: {
      gzipBytes: Math.floor(baselines.browser.gzipBytes * (1 + BYTE_REGRESSION_PCT / 100)),
      coldStartMs:
        baselines.browser.coldStartMs * (1 + COLD_START_REGRESSION_PCT / 100),
    },
    edge: {
      gzipBytes: Math.floor(baselines.edge.gzipBytes * (1 + BYTE_REGRESSION_PCT / 100)),
      coldStartMs: baselines.edge.coldStartMs * (1 + COLD_START_REGRESSION_PCT / 100),
    },
  }
}

observed.maxAllowed = withMax(observed.baselines)

console.log('Observed:')
console.log(JSON.stringify(observed.baselines, null, 2))
console.log(
  'Cold-start p20 / median / MAD (browser):',
  browserCold.coldStartMs,
  browserCold.medianMs,
  browserCold.madMs,
)
console.log(
  'Cold-start p20 / median / MAD (edge):',
  edgeCold.coldStartMs,
  edgeCold.medianMs,
  edgeCold.madMs,
)

if (record) {
  writeFileSync(budgetsPath, `${JSON.stringify(observed, null, 2)}\n`)
  console.log(`Wrote ${budgetsPath}`)
}

if (check && !record) {
  if (!existsSync(budgetsPath)) {
    fail('budgets.json missing — run with --record once to establish baselines')
  }
  const budget = JSON.parse(readFileSync(budgetsPath, 'utf8'))
  // Migrate older budgets that stored coldStartMedianMs.
  const baselines = {
    browser: {
      gzipBytes: budget.baselines.browser.gzipBytes,
      coldStartMs:
        budget.baselines.browser.coldStartMs ?? budget.baselines.browser.coldStartMedianMs,
    },
    edge: {
      gzipBytes: budget.baselines.edge.gzipBytes,
      coldStartMs:
        budget.baselines.edge.coldStartMs ?? budget.baselines.edge.coldStartMedianMs,
    },
  }
  const max = budget.maxAllowed
    ? {
        browser: {
          gzipBytes: budget.maxAllowed.browser.gzipBytes,
          coldStartMs:
            budget.maxAllowed.browser.coldStartMs ??
            budget.maxAllowed.browser.coldStartMedianMs,
        },
        edge: {
          gzipBytes: budget.maxAllowed.edge.gzipBytes,
          coldStartMs:
            budget.maxAllowed.edge.coldStartMs ?? budget.maxAllowed.edge.coldStartMedianMs,
        },
      }
    : withMax(baselines)

  function checkMetric(label, value, limit, thresholdPct) {
    if (value > limit) {
      fail(
        `${label} regression: observed ${value} > maxAllowed ${limit} (>${thresholdPct}% over baseline). Explicit review + --record required.`,
      )
    }
  }

  checkMetric(
    'browser.gzipBytes',
    browserSize.gzipBytes,
    max.browser.gzipBytes,
    BYTE_REGRESSION_PCT,
  )
  checkMetric(
    'browser.coldStartMs',
    browserCold.coldStartMs,
    max.browser.coldStartMs,
    COLD_START_REGRESSION_PCT,
  )
  // Edge is CI-enforced (same thresholds) to catch blowups; §7.8 headline is browser.
  checkMetric('edge.gzipBytes', edgeSize.gzipBytes, max.edge.gzipBytes, BYTE_REGRESSION_PCT)
  checkMetric(
    'edge.coldStartMs',
    edgeCold.coldStartMs,
    max.edge.coldStartMs,
    COLD_START_REGRESSION_PCT,
  )

  console.log(
    `OK: size within ${BYTE_REGRESSION_PCT}% and cold-start p20 within ${COLD_START_REGRESSION_PCT}% of recorded baselines`,
  )
}
