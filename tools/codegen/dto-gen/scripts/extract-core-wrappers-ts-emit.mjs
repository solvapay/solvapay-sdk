#!/usr/bin/env node
// Extracts chrome for Phase 3c/3d core/server dispatch wrappers.
// IR-derived: NativeCoreSyncMethod members + wrapper function bodies.
// Chrome: file docs, imports, install gate, function order, server postamble.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const OUT_PATH = join(
  REPO_ROOT,
  'tools',
  'codegen',
  'dto-gen',
  'assets',
  'core-wrappers-ts-emit.snapshot.json',
);

const EXPORT_TO_BINDING_ID = {
  getSellerTaxIdentifierDisplayLabelByType: 'SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE',
};

const DECISIONS_POSTAMBLE_MARKER = '// --- paywall state / gate / payload ---';

function stripGenerated(src) {
  let out = src;
  while (out.startsWith('/**')) {
    const close = out.indexOf('*/');
    if (close === -1) break;
    const block = out.slice(0, close + 2);
    if (!block.includes('@generated')) break;
    let end = close + 2;
    if (out[end] === '\n') end += 1;
    if (out[end] === '\n') end += 1;
    out = out.slice(end);
  }
  return out;
}

function splitLeadingJsdoc(src) {
  if (!src.startsWith('/**')) {
    return { fileDoc: '', rest: src };
  }
  const close = src.indexOf('*/');
  if (close === -1) throw new Error('unterminated leading JSDoc');
  let end = close + 2;
  if (src[end] === '\n') end += 1;
  if (src[end] === '\n') end += 1;
  return { fileDoc: src.slice(0, close + 2), rest: src.slice(end) };
}

function findUnion(src, typeName) {
  const openRe = new RegExp(`^export type ${typeName} =\\s*$`, 'm');
  const openMatch = openRe.exec(src);
  if (!openMatch) throw new Error(`missing export type ${typeName}`);
  const declStart = openMatch.index;
  const declEnd = declStart + openMatch[0].length;
  let i = declEnd;
  if (src[i] === '\n') i += 1;
  const bodyStart = i;
  while (i < src.length) {
    const nextNl = src.indexOf('\n', i);
    const lineEnd = nextNl === -1 ? src.length : nextNl;
    const line = src.slice(i, lineEnd);
    if (line === '') {
      return { declStart, declEnd, bodyStart, bodyEnd: i, afterUnion: lineEnd + 1 };
    }
    if (!/^\s*(\| '|\/\/)/.test(line)) {
      throw new Error(`unexpected line inside ${typeName} union: ${JSON.stringify(line)}`);
    }
    i = lineEnd + 1;
  }
  throw new Error(`unterminated ${typeName} union`);
}

function extractDispatch() {
  const path = join(REPO_ROOT, 'packages', 'core', 'src', 'native-dispatch.ts');
  const original = readFileSync(path, 'utf8');
  const src = stripGenerated(original);
  const { fileDoc, rest } = splitLeadingJsdoc(src);
  const union = findUnion(rest, 'NativeCoreSyncMethod');
  const preamble = `${fileDoc}\n\n${rest.slice(0, union.declEnd)}\n`;
  const body = rest.slice(union.bodyStart, union.bodyEnd);
  const comments = [];
  const domainMembers = [];
  const helpersMembers = [];
  let group = 'domain';
  for (const line of body.split('\n')) {
    if (/^\s*\/\//.test(line)) {
      comments.push(line);
      if (comments.length === 2) group = 'helpers';
      continue;
    }
    const m = line.match(/\| '([^']+)'/);
    if (m) {
      if (group === 'domain') domainMembers.push(m[1]);
      else helpersMembers.push(m[1]);
    }
  }
  if (comments.length !== 2) {
    throw new Error(`expected 2 NativeCoreSyncMethod group comments, got ${comments.length}`);
  }
  return {
    preamble,
    domainComment: comments[0],
    helpersComment: comments[1],
    domainMembers,
    helpersMembers,
    postamble: rest.slice(union.afterUnion),
  };
}

function extractFunctionsFile(relPath, { splitPostambleAt } = {}) {
  const path = join(REPO_ROOT, relPath);
  const original = readFileSync(path, 'utf8');
  const src = stripGenerated(original);
  const { fileDoc, rest } = splitLeadingJsdoc(src);
  let functionsSrc = rest;
  let postamble = '';
  if (splitPostambleAt) {
    const idx = rest.indexOf(splitPostambleAt);
    if (idx === -1) throw new Error(`missing postamble marker ${splitPostambleAt} in ${relPath}`);
    functionsSrc = rest.slice(0, idx);
    postamble = rest.slice(idx);
  }
  const firstSection = functionsSrc.indexOf('// --- ');
  if (firstSection === -1) throw new Error(`missing section comment in ${relPath}`);
  const preamble = `${fileDoc}\n\n${functionsSrc.slice(0, firstSection)}`;
  const sectionBefore = {};
  const symbolOrder = [];
  let pendingSection = null;
  for (const line of functionsSrc.slice(firstSection).split('\n')) {
    const section = line.match(/^\/\/ --- (.+) ---$/);
    if (section) {
      pendingSection = line;
      continue;
    }
    const fn = line.match(/^export function ([A-Za-z0-9_]+)/);
    if (fn) {
      const id = EXPORT_TO_BINDING_ID[fn[1]] ?? fn[1];
      if (pendingSection) {
        sectionBefore[id] = pendingSection;
        pendingSection = null;
      }
      symbolOrder.push(id);
    }
  }
  const out = { preamble, symbolOrder, sectionBefore };
  if (postamble) out.postamble = postamble;
  return out;
}

function main() {
  const output = {
    _comment:
      'generated by extract-core-wrappers-ts-emit.mjs — chrome for Phase 3c/3d wrapper emitters',
    files: {
      dispatch: extractDispatch(),
      nativeCore: extractFunctionsFile('packages/core/src/native-core.ts'),
      nativeHelpers: extractFunctionsFile('packages/core/src/native-helpers.ts'),
      nativeDecisions: extractFunctionsFile('packages/server/src/native-decisions.ts', {
        splitPostambleAt: DECISIONS_POSTAMBLE_MARKER,
      }),
    },
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${OUT_PATH}`);
  for (const [key, file] of Object.entries(output.files)) {
    const n = file.symbolOrder?.length ?? 'union';
    console.log(`  ${key}: ${n}`);
  }
}

main();
