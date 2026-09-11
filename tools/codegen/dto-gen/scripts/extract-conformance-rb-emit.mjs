#!/usr/bin/env node
// Extracts Ruby fixture-conformance chrome from sdks/ruby/test/contract/
// into assets/conformance-rb-emit.snapshot.json.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CONTRACT = join(REPO_ROOT, 'sdks', 'ruby', 'test', 'contract');
const OUT_PATH = join(
  REPO_ROOT,
  'tools',
  'codegen',
  'dto-gen',
  'assets',
  'conformance-rb-emit.snapshot.json',
);

const FILE_ORDER = [
  'clock.rb',
  'names.rb',
  'fixture_loader.rb',
  'compare.rb',
  'stub_backend.rb',
  'host_adapters.rb',
  'dispatch.rb',
];

const NOW_MS_BLOCK =
  /(?:      if name == "[^"]+"\n        args\["nowMs"\] = Clock\.unix_ms\(fixture\.fetch\("input"\)\.fetch\("clock"\)\)\n      end\n)+/;

const HOST_FNS_INNER = /HOST_FUNCTIONS = %w\[\n((?:      [A-Za-z0-9_]+\n)+)    \]\.freeze/;

function stripGeneratedHeader(src) {
  if (!src.startsWith('# @generated')) {
    return src;
  }
  const nl = src.indexOf('\n');
  let rest = nl === -1 ? '' : src.slice(nl + 1);
  if (rest.startsWith('\n')) {
    rest = rest.slice(1);
  }
  return rest;
}

function extractHostFns(inner) {
  return inner
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function extractDispatchSpecialCases(dispatchSrc) {
  const special = {};
  const assertMatch = dispatchSrc.match(
    /error_name: "Error", error_message: error\.message \} if name == "([^"]+)"/,
  );
  if (!assertMatch) {
    throw new Error('dispatch.rb missing assert_response_result special case');
  }
  special[assertMatch[1]] = 'js_error';
  const validateMatch = dispatchSrc.match(
    /if name == "([^"]+)" && value\.is_a\?\(String\)/,
  );
  if (!validateMatch) {
    throw new Error('dispatch.rb missing validate_public_base_url special case');
  }
  special[validateMatch[1]] = 'option_string_as_error';
  return special;
}

const onDisk = new Set(
  readdirSync(CONTRACT).filter(name => name.endsWith('.rb') && !name.startsWith('.')),
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
let hostFns;
let dispatchSpecialCases;

for (const name of FILE_ORDER) {
  let body = stripGeneratedHeader(readFileSync(join(CONTRACT, name), 'utf8'));
  if (name === 'host_adapters.rb') {
    const hostMatch = body.match(HOST_FNS_INNER);
    if (!hostMatch) {
      throw new Error('host_adapters.rb missing HOST_FUNCTIONS %w list');
    }
    hostFns = extractHostFns(hostMatch[1]);
    body = body.replace(hostMatch[0], 'HOST_FUNCTIONS = %w[\n{{HOST_FNS}}\n    ].freeze');
  }
  if (name === 'dispatch.rb') {
    dispatchSpecialCases = extractDispatchSpecialCases(body);
    if (!NOW_MS_BLOCK.test(body)) {
      throw new Error('dispatch.rb missing nowMs clock-injection block');
    }
    body = body.replace(NOW_MS_BLOCK, '{{NOW_MS_INJECTION}}');
  }
  files[name] = { body };
}

const snapshot = {
  files,
  hostFns,
  dispatchSpecialCases,
};

writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `wrote ${OUT_PATH} files=${FILE_ORDER.length} hostFns=${hostFns.length}`,
);
