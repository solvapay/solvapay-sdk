#!/usr/bin/env node
// Extracts native-side TS marshalling chrome (native.ts / wasm.ts) into a
// snapshot consumed by the step 39G-c emitters. Deterministic: pure
// source-text parsing, no timestamps, no filesystem ordering dependence.
//
// Per file, the only IR-derived content is the two method-name unions.
// Everything else (imports, loaders, envelope reconstructor, helpers) is
// captured here as chrome.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const OUT_PATH = join(
  REPO_ROOT,
  'rust',
  'tools',
  'dto-gen',
  'assets',
  'native-ts-emit.snapshot.json',
);

const FILES = {
  native: {
    path: join(REPO_ROOT, 'packages', 'server', 'src', 'native.ts'),
    clientType: 'NativeClientMethod',
    syncType: 'NativeSyncMethod',
  },
  wasm: {
    path: join(REPO_ROOT, 'packages', 'server', 'src', 'wasm.ts'),
    clientType: 'WasmClientMethod',
    syncType: 'WasmSyncMethod',
  },
};

/**
 * Strips a leading `/** ... *​/` JSDoc block (and one trailing blank line).
 * Used so the emitter can re-emit a `@generated` header + the original doc.
 */
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

/**
 * Locates `export type <name> =` and returns offsets for the declaration line
 * end, the union body, and the blank line after the union close.
 */
function findUnion(src, typeName) {
  const openRe = new RegExp(`^export type ${typeName} =\\s*$`, 'm');
  const openMatch = openRe.exec(src);
  if (!openMatch) throw new Error(`missing export type ${typeName}`);
  const declStart = openMatch.index;
  const declEnd = declStart + openMatch[0].length;

  // Union body: lines of `  | '…'` and optional `  // …` comments, until a
  // blank line (prettier always leaves one after the union).
  let i = declEnd;
  if (src[i] === '\n') i += 1;
  const bodyStart = i;
  while (i < src.length) {
    const nextNl = src.indexOf('\n', i);
    const lineEnd = nextNl === -1 ? src.length : nextNl;
    const line = src.slice(i, lineEnd);
    if (line === '') {
      // blank line closes the union
      return {
        declStart,
        declEnd,
        bodyStart,
        bodyEnd: i, // exclusive; points at the blank line
        afterUnion: lineEnd + 1, // past the blank line's `\n`
      };
    }
    if (!/^\s*(\| '|\/\/)/.test(line)) {
      throw new Error(
        `unexpected line inside ${typeName} union at offset ${i}: ${JSON.stringify(line)}`,
      );
    }
    i = lineEnd + 1;
  }
  throw new Error(`unterminated ${typeName} union`);
}

/** Pulls the two grouping comments from the sync union body (order preserved). */
function extractSyncGroupComments(unionBody) {
  const comments = [];
  for (const line of unionBody.split('\n')) {
    if (/^\s*\/\//.test(line)) comments.push(line);
  }
  if (comments.length !== 2) {
    throw new Error(`expected 2 sync group comments, got ${comments.length}`);
  }
  return { core: comments[0], mcp: comments[1] };
}

function extractFile(key, spec) {
  const original = readFileSync(spec.path, 'utf8');
  // Drop a leading `@generated` block if present (idempotent re-extract after regen).
  let src = original;
  if (src.startsWith('/**\n * @generated')) {
    const close = src.indexOf('*/');
    let end = close + 2;
    if (src[end] === '\n') end += 1;
    if (src[end] === '\n') end += 1;
    src = src.slice(end);
  }

  const { fileDoc, rest } = splitLeadingJsdoc(src);
  // Offsets below are relative to `rest` (post file-doc). We rebuild absolute
  // slices against `rest` and keep `fileDoc` separate for the emitter header.
  const client = findUnion(rest, spec.clientType);
  const sync = findUnion(rest, spec.syncType);

  const preamble = `${fileDoc}\n\n${rest.slice(0, client.declEnd)}\n`;
  const clientToSyncBridge = rest.slice(client.afterUnion, sync.declEnd) + '\n';
  const syncBody = rest.slice(sync.bodyStart, sync.bodyEnd);
  const syncGroupComments = extractSyncGroupComments(syncBody);
  const postamble = rest.slice(sync.afterUnion);

  const clientMembers = [...rest.slice(client.bodyStart, client.bodyEnd).matchAll(/\| '([^']+)'/g)];
  const syncMembers = [...syncBody.matchAll(/\| '([^']+)'/g)];

  return {
    preamble,
    clientToSyncBridge,
    syncGroupComments,
    postamble,
    _diagnostics: {
      clientMembers: clientMembers.length,
      syncMembers: syncMembers.length,
      clientType: spec.clientType,
      syncType: spec.syncType,
    },
  };
}

function main() {
  const files = {};
  for (const [key, spec] of Object.entries(FILES)) {
    files[key] = extractFile(key, spec);
  }

  const output = {
    _comment:
      'generated by extract-native-ts-emit.mjs — chrome for step 39G-c native.ts / wasm.ts emitters',
    files: {
      native: {
        preamble: files.native.preamble,
        clientToSyncBridge: files.native.clientToSyncBridge,
        syncGroupComments: files.native.syncGroupComments,
        postamble: files.native.postamble,
      },
      wasm: {
        preamble: files.wasm.preamble,
        clientToSyncBridge: files.wasm.clientToSyncBridge,
        syncGroupComments: files.wasm.syncGroupComments,
        postamble: files.wasm.postamble,
      },
    },
    diagnostics: {
      native: files.native._diagnostics,
      wasm: files.wasm._diagnostics,
    },
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`wrote ${OUT_PATH}`);
  for (const [key, d] of Object.entries(output.diagnostics)) {
    console.log(
      `  ${key}: ${d.clientMembers} ${d.clientType} + ${d.syncMembers} ${d.syncType}`,
    );
  }
}

main();
