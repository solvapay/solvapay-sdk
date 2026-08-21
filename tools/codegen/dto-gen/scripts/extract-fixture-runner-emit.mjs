#!/usr/bin/env node
// Extracts fixture-runner chrome from tools/conformance/fixture-runner/src/bindings.rs
// into assets/fixture-runner-emit.snapshot.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const BINDINGS = join(REPO_ROOT, 'tools', 'conformance', 'fixture-runner', 'src', 'bindings.rs');
const SYMBOLS = join(REPO_ROOT, 'contract', 'manifest', 'binding-symbols.snapshot.json');
const OUT_PATH = join(
  REPO_ROOT,
  'tools',
  'codegen',
  'dto-gen',
  'assets',
  'fixture-runner-emit.snapshot.json',
);

const EXTRAS = [
  'withRetry',
  'pollBalanceUntilIncreased',
  'TOPUP_BALANCE_POLL_DELAYS_MS',
  'BALANCE_RECONCILE_DELAYS_MS',
  'constructSdkError',
  'resolveAuthenticatedUser',
];
const SKIP = ['retryNextDelayMs'];
const WEBHOOK_KEEP = ['verifyWebhook'];

function captureInvoke(src, from) {
  const box = src.indexOf('Box::new(', from);
  if (box < 0) throw new Error('missing Box::new');
  const start = box + 'Box::new('.length;
  if (src[start] === '|') {
    let i = start;
    let depth = 0;
    let saw = false;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') {
        depth += 1;
        saw = true;
      } else if (src[i] === '}') {
        depth -= 1;
        if (saw && depth === 0) {
          return src.slice(start, i + 1).trim();
        }
      }
    }
    throw new Error('unclosed closure');
  }
  const end = src.indexOf(')', start);
  return src.slice(start, end).trim();
}

const src = readFileSync(BINDINGS, 'utf8');
const ir = JSON.parse(readFileSync(SYMBOLS, 'utf8')).bindings;
const order = [];
const routing = {};
const extras = {};

let search = 0;
while (true) {
  const idx = src.indexOf('registry.register(', search);
  if (idx < 0) break;
  const q = src.indexOf('"', idx);
  const q2 = src.indexOf('"', q + 1);
  const id = src.slice(q + 1, q2);
  const invoke = captureInvoke(src, q2);
  order.push(id);
  const extra = EXTRAS.includes(id);
  const sym = ir[id];
  const isWrap =
    sym &&
    sym.call?.kind === 'wrap' &&
    !WEBHOOK_KEEP.includes(id) &&
    !SKIP.includes(id);
  if (extra) {
    extras[id] = invoke.startsWith('|')
      ? invoke
      : `crate::bindings::${invoke}`;
  } else if (!isWrap) {
    routing[id] = invoke.startsWith('|')
      ? invoke
      : invoke.startsWith('invoke_')
        ? `crate::bindings::${invoke}`
        : `crate::bindings::${invoke}`;
  }
  search = q2 + 1;
}

const snapshot = {
  header: `//! Generated fixture-runner registry: wrap invoke bodies plus the registration table.\n#![allow(missing_docs, clippy::missing_docs_in_private_items)]\n`,
  preamble: `#[allow(unused_imports)]
use serde_json::{Map, Value};

#[allow(unused_imports)]
use crate::extract::*;
use crate::model::FixtureInput;
use crate::runner::{Binding, BindingError, BindingRegistry};
`,
  order,
  routing,
  extras,
  skip: SKIP,
  webhookKeep: WEBHOOK_KEEP,
};

writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote ${OUT_PATH} order=${order.length} routing=${Object.keys(routing).length} extras=${Object.keys(extras).length}`);
