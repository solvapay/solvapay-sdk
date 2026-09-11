#!/usr/bin/env node
// Extracts C fixture-conformance chrome from sdks/capi/ctest/contract/
// into assets/conformance-c-emit.snapshot.json.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CONTRACT = join(REPO_ROOT, 'sdks', 'capi', 'ctest', 'contract');
const OUT_PATH = join(
  REPO_ROOT,
  'tools',
  'codegen',
  'dto-gen',
  'assets',
  'conformance-c-emit.snapshot.json',
);

const FILE_ORDER = ['dispatch.c', 'dispatch.h', 'harness.c', 'harness.h'];

const CLIENT_OPS_INNER =
  /static const char \*kClientOps\[\] = \{\n((?:  "[^"]+",\n)+)\};/;

function stripGeneratedHeader(src) {
  if (src.startsWith('/* @generated')) {
    const end = src.indexOf('*/');
    if (end === -1) {
      throw new Error('unterminated generated header');
    }
    let rest = src.slice(end + 2);
    if (rest.startsWith('\n')) {
      rest = rest.slice(1);
    }
    if (rest.startsWith('\n')) {
      rest = rest.slice(1);
    }
    return rest;
  }
  if (src.startsWith('// @generated')) {
    const nl = src.indexOf('\n');
    let rest = nl === -1 ? '' : src.slice(nl + 1);
    if (rest.startsWith('\n')) {
      rest = rest.slice(1);
    }
    return rest;
  }
  return src;
}

const onDisk = new Set(
  readdirSync(CONTRACT).filter(name => !name.startsWith('.')),
);
for (const name of FILE_ORDER) {
  if (!onDisk.has(name)) {
    throw new Error(`missing contract module ${name}`);
  }
}
for (const name of onDisk) {
  if (!FILE_ORDER.includes(name)) {
    throw new Error(`unexpected contract module ${name} — add it to FILE_ORDER or exclude it`);
  }
}

const files = {};
let clientOpCount = 0;

for (const name of FILE_ORDER) {
  let body = stripGeneratedHeader(readFileSync(join(CONTRACT, name), 'utf8'));
  if (name === 'dispatch.c') {
    const match = body.match(CLIENT_OPS_INNER);
    if (!match) {
      throw new Error('dispatch.c missing kClientOps table');
    }
    clientOpCount = [...match[1].matchAll(/"([^"]+)"/g)].length;
    body = body.replace(
      match[0],
      'static const char *kClientOps[] = {\n{{CLIENT_OPS}}\n};',
    );
  }
  files[name] = { body };
}

const snapshot = {
  files,
};

writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `wrote ${OUT_PATH} files=${FILE_ORDER.length} clientOps=${clientOpCount}`,
);
