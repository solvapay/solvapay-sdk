#!/usr/bin/env node
// Extracts enriched emit metadata for the node/wasm napi + wasm-bindgen
// bindings (decisions / payloadBuilders / client) into a single JSON
// snapshot consumed by the step 39G-b shim emitters. Deterministic: pure
// source-text parsing, no timestamps, no filesystem ordering dependence.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const OUT_PATH = join(REPO_ROOT, 'rust', 'tools', 'dto-gen', 'assets', 'binding-emit.snapshot.json');

const FILES = {
  node: {
    decisions: join(REPO_ROOT, 'rust', 'bindings', 'node', 'src', 'decisions.rs'),
    payloadBuilders: join(REPO_ROOT, 'rust', 'bindings', 'node', 'src', 'payload_builders.rs'),
    client: join(REPO_ROOT, 'rust', 'bindings', 'node', 'src', 'native_client.rs'),
    argsRs: join(REPO_ROOT, 'rust', 'bindings', 'node', 'src', 'args.rs'),
  },
  wasm: {
    decisions: join(REPO_ROOT, 'rust', 'bindings', 'wasm', 'src', 'decisions.rs'),
    payloadBuilders: join(REPO_ROOT, 'rust', 'bindings', 'wasm', 'src', 'payload_builders.rs'),
    client: join(REPO_ROOT, 'rust', 'bindings', 'wasm', 'src', 'wasm_client.rs'),
    argsRs: join(REPO_ROOT, 'rust', 'bindings', 'wasm', 'src', 'args.rs'),
  },
};

const ATTR_MACRO_BY_LANG = { node: 'napi', wasm: 'wasm_bindgen' };

// --- helper mapping (per spec §5) -----------------------------------------

const SIMPLE_HELPER_EXTRACT = {
  require_string: 'requireString',
  optional_string: 'optionalString',
  require_f64: 'requireF64',
  optional_f64: 'optionalF64',
  require_i64: 'requireI64',
  require_u32: 'requireU32',
  optional_u16: 'optionalU16',
  optional_u32: 'optionalU32',
  optional_u64: 'optionalU64',
  require_bool: 'requireBool',
  require_object: 'requireObject',
  require_array: 'requireArray',
};

// --- low-level source scanning (string/comment aware) ---------------------

/** Replaces string/comment contents with spaces (same length, newlines kept). */
function maskStringsAndComments(text) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (c === '"') {
      out[i] = ' ';
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          out[i] = ' ';
          i += 1;
          if (i < n) {
            out[i] = ' ';
            i += 1;
          }
          continue;
        }
        if (text[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Finds the index of the brace matching `masked[openIdx] === '{'`. */
function findMatchingBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces from index ${openIdx}`);
}

/** Splits `original[from:to]` at top-level occurrences of `delim` (using `masked` for depth). */
function splitTopLevel(original, masked, from, to, delim) {
  const parts = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i += 1) {
    const c = masked[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === delim && depth === 0) {
      parts.push(original.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(original.slice(start, to));
  return parts;
}

// --- section markers --------------------------------------------------------

const SECTION_RE = /^[ \t]*\/\/\s*---\s*(.+?)\s*-+\s*$/gm;

function collectSections(original) {
  const sections = [];
  let match;
  const re = new RegExp(SECTION_RE);
  while ((match = re.exec(original)) !== null) {
    sections.push({ index: match.index, name: match[1].trim() });
  }
  return sections;
}

function sectionFor(sections, index) {
  let current;
  for (const s of sections) {
    if (s.index <= index) current = s.name;
    else break;
  }
  return current;
}

// --- header / tests-trailer extraction --------------------------------------

const HEADER_STOP_RE = /^(\/\/\/|\/\/\s*---|pub )/;

function extractHeader(original) {
  const lines = original.split('\n');
  let stopIdx = lines.length;
  for (let i = 1; i < lines.length; i += 1) {
    if (HEADER_STOP_RE.test(lines[i])) {
      stopIdx = i;
      break;
    }
  }
  return `${lines.slice(0, stopIdx).join('\n')}\n`;
}

function extractTestsTrailer(original) {
  const lines = original.split('\n');
  const idx = lines.findIndex((line) => line.trim() === '#[cfg(test)]');
  if (idx === -1) return '';
  return lines.slice(idx).join('\n');
}

// --- binding entry extraction ------------------------------------------------

/**
 * Scans `original` for every `#[<macro>(js_name = "...")]`-annotated fn and
 * returns entries with doc/section/signature/body spans (in file order).
 */
function extractEntries(original, macro, sections) {
  const masked = maskStringsAndComments(original);
  const attrRe = new RegExp(`#\\[${macro}\\(js_name\\s*=\\s*"([^"]+)"\\)\\]`, 'g');
  const lineStarts = computeLineStarts(original);
  const entries = [];
  let match;
  while ((match = attrRe.exec(original)) !== null) {
    const jsName = match[1];
    const attrIdx = match.index;

    const lineIdx = lineIndexForOffset(lineStarts, attrIdx);
    const lines = original.split('\n');
    let docStartLine = lineIdx;
    while (docStartLine > 0 && lines[docStartLine - 1].trim().startsWith('///')) {
      docStartLine -= 1;
    }
    const docLines = lines.slice(docStartLine, lineIdx).map((l) => l.trim());
    const doc = docLines
      .map((l) => l.replace(/^\/\/\/\s?/, ''))
      .join('\n')
      .trim();
    const docStart = lineStarts[docStartLine];

    const fnMatch = /\bfn\s+(\w+)/.exec(original.slice(match.index + match[0].length));
    if (!fnMatch) throw new Error(`no fn found after ${jsName} attribute`);
    const fnKeywordStart = match.index + match[0].length + fnMatch.index;
    const fnNameEnd = fnKeywordStart + fnMatch[0].length;
    const rustFnName = fnMatch[1];

    const sigParenStart = original.indexOf('(', fnNameEnd);
    const sigParenEnd = findMatchingParen(masked, sigParenStart);
    const signature = original.slice(fnNameEnd, sigParenEnd + 1);
    const isAsync = original.slice(Math.max(0, fnKeywordStart - 10), fnKeywordStart).includes('async');
    const paramMatch = /(_?args_json)\s*:\s*String/.exec(signature);
    const paramName = paramMatch ? paramMatch[1] : null;

    const bodyOpenIdx = masked.indexOf('{', sigParenEnd);
    const bodyCloseIdx = findMatchingBrace(masked, bodyOpenIdx);
    const fnBody = original.slice(bodyOpenIdx + 1, bodyCloseIdx);

    const section = sectionFor(sections, docStart);

    entries.push({
      jsName,
      rustFnName,
      doc,
      section,
      isAsync,
      paramName,
      docStart,
      entryEnd: bodyCloseIdx + 1,
      fnBody,
    });
  }
  return entries;
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineIndexForOffset(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findMatchingParen(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parens from index ${openIdx}`);
}

/** Extracts the inner closure body from `run_envelope_sync(|| { ... })` / `run_envelope(async move { ... })`. */
function extractInnerBody(fnBody, isAsync) {
  const masked = maskStringsAndComments(fnBody);
  const marker = isAsync ? 'run_envelope(' : 'run_envelope_sync(';
  const markerIdx = masked.indexOf(marker);
  if (markerIdx === -1) return null;
  const openBraceIdx = masked.indexOf('{', markerIdx);
  if (openBraceIdx === -1) return null;
  const closeBraceIdx = findMatchingBrace(masked, openBraceIdx);
  return fnBody.slice(openBraceIdx + 1, closeBraceIdx).trim();
}

// --- sync body classification (decisions / payloadBuilders) -----------------

const ARG_SIMPLE_RE = /^&?[A-Za-z_][A-Za-z0-9_]*(\.(as_deref|as_ref)\(\))?$/;

function splitArgs(original, masked, from, to) {
  const raw = splitTopLevel(original, masked, from, to, ',');
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseExtractorStatement(stmt) {
  let m = /^let\s+(\w+)\s*=\s*args_map\(&args_json\)\?$/.exec(stmt);
  if (m) return { kind: 'argsMap', local: m[1] };

  m = new RegExp(
    `^let\\s+(\\w+)\\s*=\\s*(${Object.keys(SIMPLE_HELPER_EXTRACT).join('|')})\\(&args,\\s*"([^"]+)"\\)\\?$`,
  ).exec(stmt);
  if (m) {
    return { kind: 'extract', local: m[1], extract: SIMPLE_HELPER_EXTRACT[m[2]], name: m[3] };
  }

  m = /^let\s+(\w+)\s*=\s*optional_value\(&args,\s*"([^"]+)"\)$/.exec(stmt);
  if (m) return { kind: 'extract', local: m[1], extract: 'optionalValue', name: m[2] };

  m = /^let\s+(\w+)\s*=\s*args\.get\("([^"]+)"\)\.cloned\(\)\.unwrap_or\(Value::Null\)$/.exec(stmt);
  if (m) return { kind: 'extract', local: m[1], extract: 'rawValueOrNull', name: m[2] };

  m = /^let\s+(\w+)\s*=\s*(require_typed|optional_typed)::<([\w:]+)>\(&args,\s*"([^"]+)"\)\?$/.exec(
    stmt,
  );
  if (m) {
    return {
      kind: 'extract',
      local: m[1],
      extract: m[2] === 'require_typed' ? 'requireTyped' : 'optionalTyped',
      typedAs: m[3],
      typedStyle: 'turbofish',
      name: m[4],
    };
  }

  m = /^let\s+(\w+):\s*([\w:]+)\s*=\s*(require_typed|optional_typed)\(&args,\s*"([^"]+)"\)\?$/.exec(
    stmt,
  );
  if (m) {
    return {
      kind: 'extract',
      local: m[1],
      extract: m[3] === 'require_typed' ? 'requireTyped' : 'optionalTyped',
      typedAs: m[2],
      typedStyle: 'annotation',
      name: m[4],
    };
  }

  return null;
}

const TAIL_PATTERNS = [
  { re: /^to_value\(&(\w+)\(([\s\S]*)\)\)$/, serialize: 'toValue' },
  { re: /^Ok\(Value::Bool\((\w+)\(([\s\S]*)\)\)\)$/, serialize: 'valueBool' },
  { re: /^Ok\(Value::String\((\w+)\(([\s\S]*)\)\)\)$/, serialize: 'valueString' },
  { re: /^option_helper_err\((\w+)\(([\s\S]*)\)\)$/, serialize: 'optionHelperErr' },
  { re: /^result_as_value\((\w+)\(([\s\S]*)\)\)$/, serialize: 'resultAsValue' },
];

function classifySyncBody(body) {
  const masked = maskStringsAndComments(body);
  const stmts = splitTopLevel(body, masked, 0, body.length, ';').map((s) => s.trim());
  const tail = stmts.pop();
  if (stmts.length === 0) return null;

  const first = parseExtractorStatement(stmts[0]);
  if (!first || first.kind !== 'argsMap') return null;

  const args = [];
  for (let i = 1; i < stmts.length; i += 1) {
    const parsed = parseExtractorStatement(stmts[i]);
    if (!parsed || parsed.kind !== 'extract') return null;
    const arg = { name: parsed.name, extract: parsed.extract, local: parsed.local };
    if (parsed.typedAs) arg.typedAs = parsed.typedAs;
    // Only record a non-default style so turbofish stays implicit in the snapshot.
    if (parsed.typedStyle === 'annotation') arg.typedStyle = parsed.typedStyle;
    args.push(arg);
  }

  for (const pattern of TAIL_PATTERNS) {
    const m = pattern.re.exec(tail);
    if (!m) continue;
    const coreCall = m[1];
    const argsStr = m[2];
    const callArgs =
      argsStr.trim().length === 0
        ? []
        : splitArgs(tail, maskStringsAndComments(tail), tail.indexOf(argsStr), tail.indexOf(argsStr) + argsStr.length);
    if (!callArgs.every((a) => ARG_SIMPLE_RE.test(a))) return null;
    return {
      args,
      call: { kind: 'wrap', serialize: pattern.serialize, args: callArgs },
      coreCall,
    };
  }
  return null;
}

// --- client body classification ---------------------------------------------

function classifyClientBody(body, paramName) {
  const masked = maskStringsAndComments(body);

  // regular typed
  let m = /^let\s+params:\s*(\w+)\s*=\s*parse_args_json\(&args_json\)\?;\s*client\.(\w+)\(params\)\.await$/.exec(
    body.trim(),
  );
  if (m) {
    return {
      dtoType: m[1],
      coreCall: m[2],
      call: { kind: 'wrap', serialize: 'clientAwait' },
    };
  }

  // ignore-args (param renamed `_args_json`, no-arg client call)
  if (paramName === '_args_json') {
    const call = /client\.(\w+)\(\)\.await/.exec(body);
    if (call) {
      return {
        coreCall: call[1],
        call: { kind: 'wrap', serialize: 'clientIgnore' },
      };
    }
  }

  // splitPathRefs
  const splitMatch = /split_path_refs\(&args_json,\s*&\[([^\]]*)\]\)\?/.exec(body);
  if (splitMatch) {
    const splitPathRefs = splitMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter((s) => s.length > 0);

    const dtoMatch = /let\s+\w+:\s*(\w+)\s*=\s*serde_json::from_value\(body\)/.exec(body);
    const dtoType = dtoMatch ? dtoMatch[1] : undefined;

    const lastCall = /client\.(\w+)\(([\s\S]*)\)\.await\s*$/.exec(body.trim());
    const coreCall = lastCall ? lastCall[1] : undefined;
    const clientCallArgs = lastCall
      ? splitArgs(body, masked, body.lastIndexOf(lastCall[2]), body.lastIndexOf(lastCall[2]) + lastCall[2].length)
      : [];

    const call = { kind: 'wrap', serialize: 'clientSplit' };
    if (dtoType) call.dtoType = dtoType;
    return {
      dtoType,
      splitPathRefs,
      coreCall,
      clientCallArgs,
      call,
    };
  }

  return null;
}

// --- per-file / per-lang assembly --------------------------------------------

function loadFile(path) {
  return readFileSync(path, 'utf8');
}

function buildSyncArtifact(lang, artifactName, path) {
  const original = loadFile(path);
  const sections = collectSections(original);
  const macro = ATTR_MACRO_BY_LANG[lang];
  const entries = extractEntries(original, macro, sections);
  const header = extractHeader(original);
  const testsTrailer = extractTestsTrailer(original);

  const testsIdx = (() => {
    const lines = original.split('\n');
    const idx = lines.findIndex((line) => line.trim() === '#[cfg(test)]');
    if (idx === -1) return original.length;
    return computeLineStarts(original)[idx];
  })();

  let mcpPayloadModuleSymbolIds;
  let mcpPayloadModuleHeader;
  let mcpPayloadHelpers;
  let payloadHelpers;
  const masked = maskStringsAndComments(original);
  if (lang === 'wasm' && artifactName === 'payloadBuilders') {
    const modMatch = /mod\s+mcp_payload\s*\{/.exec(original);
    if (modMatch) {
      const openIdx = masked.indexOf('{', modMatch.index);
      const closeIdx = findMatchingBrace(masked, openIdx);
      const modEntries = entries.filter((e) => e.docStart >= openIdx && e.docStart < closeIdx);
      mcpPayloadModuleSymbolIds = modEntries.map((e) => e.jsName);
      const publicEntries = entries.filter((e) => e.docStart < openIdx);
      const lastPublic = publicEntries[publicEntries.length - 1];
      const firstMod = modEntries[0];
      const lastMod = modEntries[modEntries.length - 1];
      // mod header: mod doc + `#[cfg]` + `mod mcp_payload {` + use block (strip section comment).
      mcpPayloadModuleHeader = original
        .slice(lastPublic.entryEnd, firstMod.docStart)
        .replace(/^[\s\S]*?\/\/ ---[^\n]*\n/, '')
        .replace(/^\n+/, '');
      // mod helpers: private fns after the last MCP symbol, before mod close.
      mcpPayloadHelpers = original.slice(lastMod.entryEnd, closeIdx).trim();
    }
  } else if (lang === 'node' && artifactName === 'payloadBuilders') {
    const lastEntry = entries[entries.length - 1];
    payloadHelpers = original.slice(lastEntry.entryEnd, testsIdx).trim();
  }

  const symbols = entries.map((entry) => {
    const innerBody = extractInnerBody(entry.fnBody, entry.isAsync);
    const classified = innerBody === null ? null : classifySyncBody(innerBody);
    return { entry, innerBody, classified };
  });

  return {
    original,
    header,
    testsTrailer,
    mcpPayloadModuleSymbolIds,
    mcpPayloadModuleHeader,
    mcpPayloadHelpers,
    payloadHelpers,
    symbols,
  };
}

function buildClientArtifact(lang, path) {
  const original = loadFile(path);
  const masked = maskStringsAndComments(original);
  const sections = collectSections(original);
  const macro = ATTR_MACRO_BY_LANG[lang];
  const entries = extractEntries(original, macro, sections);
  const header = extractHeader(original);

  // preamble: file start (below header) through the constructor `new(...)` close.
  const ctorAttr = new RegExp(`#\\[${macro}\\(constructor\\)\\]`).exec(masked);
  if (!ctorAttr) throw new Error(`no constructor attribute found in ${path}`);
  const fnNewIdx = masked.indexOf('fn new', ctorAttr.index);
  const ctorParenStart = masked.indexOf('(', fnNewIdx);
  const ctorParenEnd = findMatchingParen(masked, ctorParenStart);
  const ctorBodyOpen = masked.indexOf('{', ctorParenEnd);
  const ctorBodyClose = findMatchingBrace(masked, ctorBodyOpen);
  const preamble = `${original.slice(header.length, ctorBodyClose + 1).replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

  // postamble: everything after the impl block closes (dispatch + split_path_refs).
  const implMatch = /\bimpl\s+\w+\s*\{/.exec(masked);
  if (!implMatch) throw new Error(`no impl block found in ${path}`);
  const implOpen = implMatch.index + implMatch[0].length - 1;
  const implClose = findMatchingBrace(masked, implOpen);
  const postamble = `${original.slice(implClose + 1).replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

  const symbols = entries.map((entry) => {
    const innerBody = extractInnerBody(entry.fnBody, entry.isAsync);
    const classified = innerBody === null ? null : classifyClientBody(innerBody, entry.paramName);
    return { entry, innerBody, classified };
  });

  return { original, header, preamble, postamble, symbols };
}

// --- top-level orchestration --------------------------------------------------

function normalizeBody(body) {
  return body.replace(/\s+/g, ' ').trim();
}

function main() {
  const nodeArgsRs = loadFile(FILES.node.argsRs);
  const wasmArgsRs = loadFile(FILES.wasm.argsRs);

  const nodeDecisions = buildSyncArtifact('node', 'decisions', FILES.node.decisions);
  const wasmDecisions = buildSyncArtifact('wasm', 'decisions', FILES.wasm.decisions);
  const nodePayload = buildSyncArtifact('node', 'payloadBuilders', FILES.node.payloadBuilders);
  const wasmPayload = buildSyncArtifact('wasm', 'payloadBuilders', FILES.wasm.payloadBuilders);
  const nodeClient = buildClientArtifact('node', FILES.node.client);
  const wasmClient = buildClientArtifact('wasm', FILES.wasm.client);

  const symbols = {};
  const stats = { regular: 0, verbatim: 0, client: 0 };
  const mismatches = [];

  function addSyncSymbols(artifactName, nodeArtifact, wasmArtifact) {
    nodeArtifact.symbols.forEach((sym, emitOrder) => {
      const { entry, innerBody, classified } = sym;
      const wasmSym = wasmArtifact.symbols.find((s) => s.entry.jsName === entry.jsName);
      const base = {
        artifact: artifactName,
        emitOrder,
        section: entry.section,
        doc: entry.doc,
        rustFnName: entry.rustFnName,
      };
      // Wasm doc override when the hand-written mirror doc differs from node.
      if (wasmSym && wasmSym.entry.doc !== entry.doc) base.docWasm = wasmSym.entry.doc;
      if (classified) {
        stats.regular += 1;
        symbols[entry.jsName] = {
          ...base,
          args: classified.args,
          call: classified.call,
          coreCall: classified.coreCall,
        };
      } else {
        stats.verbatim += 1;
        const verbatimBody = innerBody ?? '';
        const entrySym = {
          ...base,
          call: { kind: 'verbatim' },
          verbatimBody,
        };
        const wasmBody = wasmSym ? wasmSym.innerBody ?? '' : '';
        if (wasmSym && normalizeBody(wasmBody) !== normalizeBody(verbatimBody)) {
          entrySym.verbatimBodyWasm = wasmBody;
        }
        symbols[entry.jsName] = entrySym;
      }
    });

    const wasmByName = new Map(wasmArtifact.symbols.map((s) => [s.entry.jsName, s]));
    for (const sym of nodeArtifact.symbols) {
      const wasmSym = wasmByName.get(sym.entry.jsName);
      if (!wasmSym) {
        mismatches.push({ jsName: sym.entry.jsName, artifact: artifactName, reason: 'missing-in-wasm' });
        continue;
      }
      if (normalizeBody(sym.innerBody ?? '') !== normalizeBody(wasmSym.innerBody ?? '')) {
        mismatches.push({ jsName: sym.entry.jsName, artifact: artifactName, reason: 'body-differs' });
      }
    }
    for (const sym of wasmArtifact.symbols) {
      if (!nodeArtifact.symbols.some((s) => s.entry.jsName === sym.entry.jsName)) {
        mismatches.push({ jsName: sym.entry.jsName, artifact: artifactName, reason: 'missing-in-node' });
      }
    }
  }

  addSyncSymbols('decisions', nodeDecisions, wasmDecisions);
  addSyncSymbols('payloadBuilders', nodePayload, wasmPayload);

  const wasmClientSectionByName = new Map(
    wasmClient.symbols.map((s) => [s.entry.jsName, s.entry.section]),
  );
  nodeClient.symbols.forEach((sym, emitOrder) => {
    const { entry, innerBody, classified } = sym;
    const base = {
      artifact: 'client',
      emitOrder,
      // Client group labels come from the wasm mirror (node omits the leading
      // `// --- Group A ---`; both emit Group B / Group C). The emitter suppresses
      // the leading group comment on node.
      section: wasmClientSectionByName.get(entry.jsName) ?? entry.section,
      doc: entry.doc,
      rustFnName: entry.rustFnName,
    };
    stats.client += 1;
    if (classified) {
      symbols[entry.jsName] = {
        ...base,
        ...(classified.dtoType ? { dtoType: classified.dtoType } : {}),
        ...(classified.splitPathRefs ? { splitPathRefs: classified.splitPathRefs } : {}),
        ...(classified.clientCallArgs ? { clientCallArgs: classified.clientCallArgs } : {}),
        coreCall: classified.coreCall,
        call: classified.call,
      };
    } else {
      symbols[entry.jsName] = {
        ...base,
        call: { kind: 'verbatim' },
        verbatimBody: innerBody ?? '',
      };
      mismatches.push({ jsName: entry.jsName, artifact: 'client', reason: 'unclassified-client-body' });
    }
  });

  const output = {
    _comment:
      'generated by extract-binding-emit.mjs — source of emit metadata pending YAML merge',
    artifacts: {
      node: {
        argsRs: nodeArgsRs,
        decisions: { header: nodeDecisions.header, testsTrailer: nodeDecisions.testsTrailer },
        payloadBuilders: {
          header: nodePayload.header,
          testsTrailer: nodePayload.testsTrailer,
          payloadHelpers: nodePayload.payloadHelpers ?? '',
        },
        client: {
          header: nodeClient.header,
          preamble: nodeClient.preamble,
          postamble: nodeClient.postamble,
        },
      },
      wasm: {
        argsRs: wasmArgsRs,
        decisions: { header: wasmDecisions.header, testsTrailer: wasmDecisions.testsTrailer },
        payloadBuilders: {
          header: wasmPayload.header,
          testsTrailer: wasmPayload.testsTrailer,
          mcpPayloadModuleSymbolIds: wasmPayload.mcpPayloadModuleSymbolIds ?? [],
          mcpPayloadModuleHeader: wasmPayload.mcpPayloadModuleHeader ?? '',
          mcpPayloadHelpers: wasmPayload.mcpPayloadHelpers ?? '',
        },
        client: {
          header: wasmClient.header,
          preamble: wasmClient.preamble,
          postamble: wasmClient.postamble,
        },
      },
    },
    symbols,
    diagnostics: { nodeWasmBodyMismatches: mismatches },
    stats: {
      totalSymbols: Object.keys(symbols).length,
      regular: stats.regular,
      verbatim: stats.verbatim,
      client: stats.client,
    },
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`wrote ${OUT_PATH}`);
  console.log(`symbols: ${output.stats.totalSymbols} total`);
  console.log(`  regular (structured): ${output.stats.regular}`);
  console.log(`  verbatim: ${output.stats.verbatim}`);
  console.log(`  client: ${output.stats.client}`);
  if (mismatches.length > 0) {
    console.log(`node/wasm mismatches: ${mismatches.length}`);
    for (const m of mismatches) {
      console.log(`  - [${m.artifact}] ${m.jsName}: ${m.reason}`);
    }
  } else {
    console.log('node/wasm mismatches: none');
  }
}

main();
