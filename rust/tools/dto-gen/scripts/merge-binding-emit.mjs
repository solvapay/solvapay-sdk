#!/usr/bin/env node
// Merge step 39G-b emit fields from `assets/binding-emit.snapshot.json` into the
// `bindings:` section of `contract/manifest/sdk-contract.yaml`.
//
// Additive: existing keys are preserved; only emit-time fields (artifact,
// emitOrder, section, doc, rustFnName, call, verbatimBody, verbatimBodyWasm,
// dtoType, coreCall, clientCallArgs, and per-arg extract/typedAs/local) are
// added. `verifyWebhook` has no shim symbol, so it is tagged artifact=webhook.
//
// Uses `yaml` Document API so untouched nodes keep their formatting/comments.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const contractPath = resolve(repoRoot, 'contract/manifest/sdk-contract.yaml');
const snapshotPath = resolve(here, '../assets/binding-emit.snapshot.json');

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const doc = YAML.parseDocument(readFileSync(contractPath, 'utf8'));

const bindings = doc.get('bindings');
if (!bindings || !YAML.isMap(bindings)) {
  throw new Error('sdk-contract.yaml has no bindings map');
}

/** Force a literal block scalar so multi-line bodies round-trip byte-for-byte. */
function blockLiteral(value) {
  const node = new YAML.Scalar(value);
  node.type = YAML.Scalar.BLOCK_LITERAL;
  return node;
}

/** Build a normalized `call` node from a snapshot symbol call. */
function callNode(call) {
  if (!call) return null;
  if (call.kind === 'verbatim') return { kind: 'verbatim' };
  const out = { kind: 'wrap', serialize: call.serialize };
  if (Array.isArray(call.args) && call.args.length > 0) out.args = call.args;
  return out;
}

let merged = 0;
for (const pair of bindings.items) {
  const id = String(pair.key);
  const node = pair.value;
  if (!YAML.isMap(node)) throw new Error(`binding ${id} is not a map`);

  if (id === 'verifyWebhook') {
    node.set('artifact', 'webhook');
    continue;
  }

  const sym = snapshot.symbols[id];
  if (!sym) throw new Error(`no snapshot symbol for binding ${id}`);

  node.set('artifact', sym.artifact);
  node.set('emitOrder', sym.emitOrder ?? 0);
  if (sym.section != null) node.set('section', sym.section);
  node.set('doc', sym.doc ?? '');
  if (sym.docWasm != null) node.set('docWasm', sym.docWasm);
  node.set('rustFnName', sym.rustFnName);
  const call = callNode(sym.call);
  if (call) node.set('call', doc.createNode(call));
  if (sym.coreCall != null) node.set('coreCall', sym.coreCall);
  if (sym.dtoType != null) node.set('dtoType', sym.dtoType);
  if (Array.isArray(sym.clientCallArgs) && sym.clientCallArgs.length > 0) {
    node.set('clientCallArgs', doc.createNode(sym.clientCallArgs));
  }
  if (sym.verbatimBody != null) node.set('verbatimBody', blockLiteral(sym.verbatimBody));
  if (sym.verbatimBodyWasm != null) {
    node.set('verbatimBodyWasm', blockLiteral(sym.verbatimBodyWasm));
  }

  // Per-arg extract/typedAs/local, matched positionally by name.
  const symArgs = Array.isArray(sym.args) ? sym.args : [];
  if (symArgs.length > 0) {
    const argsNode = node.get('args');
    if (!YAML.isSeq(argsNode)) {
      throw new Error(`binding ${id} has emit args but no args seq`);
    }
    const byName = new Map();
    for (const a of argsNode.items) {
      if (YAML.isMap(a)) byName.set(String(a.get('name')), a);
    }
    for (const sa of symArgs) {
      const argNode = byName.get(sa.name);
      if (!argNode) throw new Error(`binding ${id}: no contract arg named ${sa.name}`);
      argNode.set('extract', sa.extract);
      if (sa.typedAs != null) argNode.set('typedAs', sa.typedAs);
      if (sa.typedStyle != null) argNode.set('typedStyle', sa.typedStyle);
      if (sa.local != null) argNode.set('local', sa.local);
    }
  }
  merged += 1;
}

writeFileSync(contractPath, doc.toString());
console.log(`merged emit fields into ${merged} bindings (+ verifyWebhook tagged webhook)`);
