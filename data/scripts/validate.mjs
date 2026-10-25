#!/usr/bin/env node
// Validates the curated wallet matrix (data/wallets.json): its JSON Schema, the rules that span
// several objects, and a scan for strings that look like key material. No dependencies, so it
// runs offline in a bare Node container.
//
// Usage: node data/scripts/validate.mjs [--data <file>] [--schema <file>] [--allowlist <file>] [--json]
// Exit code 0 when the data passes, 1 when it does not, 2 on a usage or I/O error.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULTS = {
  data: resolve(HERE, '../wallets.json'),
  schema: resolve(HERE, '../schema/wallet-matrix.schema.json'),
  allowlist: resolve(HERE, './key-material-allowlist.json'),
};

export const CAPABILITIES = ['connects', 'signs-format', 'readable', 'deterministic', 'on-chain'];
export const FAMILIES = ['evm', 'solana', 'near', 'cardano'];
export const VALUES = ['check', 'warning', 'cross', 'not-yet-measured'];
export const STATES = ['tested', 'documented', 'unconfirmed', 'limited', 'legacy'];
const FIRST_HAND = new Set(['workspace-test', 'emulator-vector']);

// ---------------------------------------------------------------------------------------------
// JSON Schema: the subset of draft 2020-12 the schema file uses. A keyword outside the subset is
// refused rather than ignored, so a schema change can never be skipped silently.

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description']);
const KEYWORDS = new Set([
  ...ANNOTATIONS, '$defs', '$ref', 'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'pattern', 'minLength', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'oneOf',
]);

export function checkSchemaKeywords(schema, path = '#') {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`schema at ${path} is not an object`);
  }
  for (const [key, sub] of Object.entries(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`unsupported schema keyword "${key}" at ${path}`);
    if (key === 'properties' || key === '$defs') {
      for (const [name, s] of Object.entries(sub)) checkSchemaKeywords(s, `${path}/${key}/${name}`);
    } else if (key === 'items') {
      checkSchemaKeywords(sub, `${path}/items`);
    } else if (key === 'oneOf') {
      sub.forEach((s, i) => checkSchemaKeywords(s, `${path}/oneOf/${i}`));
    } else if (key === 'additionalProperties' && sub !== false) {
      throw new Error(`additionalProperties must be false at ${path}`);
    }
  }
}

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
  if (!m || !root.$defs || !(m[1] in root.$defs)) throw new Error(`unresolvable $ref ${ref}`);
  return root.$defs[m[1]];
}

export function validateSchema(schema, value, root = schema, path = '$', errors = []) {
  if (schema.$ref) validateSchema(resolveRef(root, schema.$ref), value, root, path, errors);
  const err = (message) => errors.push({ rule: 'SCHEMA', path, message });
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = jsonType(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      err(`expected ${types.join(' or ')}, found ${t}`);
      return errors;
    }
  }
  if ('const' in schema && canonical(value) !== canonical(schema.const)) err(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => canonical(e) === canonical(value))) {
    err(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}; found ${JSON.stringify(value)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) err(`shorter than ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) err(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) err(`below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) err('items are not unique');
    if (schema.items) value.forEach((v, i) => validateSchema(schema.items, v, root, `${path}[${i}]`, errors));
  }
  if (jsonType(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) err(`missing required property "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) validateSchema(sub, v, root, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) err(`unexpected property "${key}"`);
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validateSchema(s, value, root, path, []).length === 0).length;
    if (matches !== 1) err(`matches ${matches} of the oneOf alternatives, expected exactly 1`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Key material. The repository is public: no wallet's key, address or signature may appear in the
// data, whole or truncated. The patterns are deliberately broad; a public value that trips one is
// allowed only through the allowlist, each entry with its reason.

export const KEY_PATTERNS = [
  { name: 'Ethereum address', re: /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g },
  { name: '0x-prefixed hex run (an address, key, signature or hash fragment)', re: /0x[0-9a-fA-F]{8,}/g },
  { name: 'NEAR implicit account (64 hex characters)', re: /(?<![0-9a-fA-F])[0-9a-f]{64}(?![0-9a-fA-F])/g },
  { name: 'long hex run', re: /[0-9a-fA-F]{16,}/g },
  { name: 'truncated hex value', re: /[0-9a-fA-F]{8,}(?:…|\.\.\.)/g },
  { name: 'Cardano bech32 address or key', re: /\b(?:addr|addr_test|stake|stake_test|addr_vk|stake_vk|addr_xvk|acct_xvk|ed25519_pk|ed25519e_sk|drep|pool)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}/g },
  { name: 'bech32 string', re: /\b[a-z][a-z0-9_]{0,15}1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,}\b/g },
  {
    name: 'base58 run (a Solana or NEAR key)',
    re: /[1-9A-HJ-NP-Za-km-z]{32,}/g,
    // Chrome Web Store extension ids are exactly 32 letters a to p, which base58 also covers.
    accept: (m) => /^[a-p]{32}$/.test(m),
  },
  {
    name: 'base64 run (a signature or key)',
    re: /[A-Za-z0-9+/]{40,}={0,2}/g,
    // URL paths are long runs of the same alphabet; a base64 value mixes digits and both cases
    // inside one '/'-free stretch.
    accept: (m) => {
      const longest = m.split('/').reduce((a, p) => (p.length > a.length ? p : a), '');
      const count = (re) => (longest.match(re) ?? []).length;
      return !(longest.length >= 20 && count(/[0-9]/g) >= 3 && count(/[A-Z]/g) >= 3 && count(/[a-z]/g) >= 3);
    },
  },
  { name: 'NEAR named account', re: /\b[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.(?:testnet|near)(?![\w.])/g },
];

export function scanKeyMaterial(data, allowlist) {
  const errors = [];
  const used = new Set();
  const visit = (s, path) => {
    let text = s;
    for (const entry of allowlist) {
      if (typeof entry?.value === 'string' && entry.value && text.includes(entry.value)) {
        used.add(entry.value);
        text = text.split(entry.value).join(' ');
      }
    }
    // Each match is blanked once reported, so a broader pattern does not report the same value again.
    for (const { name, re, accept } of KEY_PATTERNS) {
      let reported = false;
      text = text.replace(re, (m) => {
        if (accept && accept(m)) return m;
        if (!reported) errors.push({ rule: 'KEY-MATERIAL', path, message: `looks like key material (${name}): "${m}"` });
        reported = true;
        return ' '.repeat(m.length);
      });
    }
  };
  const walk = (v, path) => {
    if (typeof v === 'string') visit(v, path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        visit(k, `${path} (key "${k}")`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(data, '$');
  allowlist.forEach((entry, i) => {
    const p = `allowlist[${i}]`;
    if (typeof entry?.value !== 'string' || !entry.value.trim()) errors.push({ rule: 'ALLOWLIST', path: p, message: 'entry has no value' });
    else if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push({ rule: 'ALLOWLIST', path: p, message: `"${entry.value}" has no reason` });
    else if (!used.has(entry.value)) errors.push({ rule: 'ALLOWLIST', path: p, message: `"${entry.value}" is not used by the data; remove it` });
  });
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Rules that span several objects. Each guards against malformed input, because they also run on
// data that failed the schema, to report every problem at once.

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const blank = (s) => typeof s !== 'string' || s.trim() === '';

export function checkRules(data) {
  const errors = [];
  const add = (rule, path, message) => errors.push({ rule, path, message });

  // Definitions: exactly the sets the page and the schema expect.
  const sameSet = (list, expected, name) => {
    const ids = arr(list).map((x) => obj(x).id);
    if (ids.length !== expected.length || expected.some((e) => !ids.includes(e))) {
      add('DEFINITIONS', `$.${name}`, `must define exactly ${expected.join(', ')}; found ${ids.join(', ')}`);
    }
  };
  sameSet(data.families, FAMILIES, 'families');
  sameSet(data.capabilities, CAPABILITIES, 'capabilities');
  sameSet(data.values, VALUES, 'values');
  sameSet(data.states, STATES, 'states');

  // Unique ids.
  const index = (list, name) => {
    const map = new Map();
    arr(list).forEach((x, i) => {
      const id = obj(x).id;
      if (map.has(id)) add('DUP-ID', `$.${name}[${i}].id`, `duplicate id "${id}" (first at ${name}[${map.get(id).i}])`);
      else map.set(id, { x: obj(x), i });
    });
    return map;
  };
  const products = index(data.products, 'products');
  const rows = index(data.rows, 'rows');
  const evidence = index(data.evidence, 'evidence');

  // Evidence items: the fields their kind needs.
  for (const [id, { x, i }] of evidence) {
    const p = `$.evidence[${i}]`;
    if ((x.kind === 'primary-source' || x.kind === 'research') && blank(x.url)) add('EVIDENCE-FIELDS', p, `${x.kind} "${id}" needs the URL of its source`);
    if (FIRST_HAND.has(x.kind) && !x.surface) add('EVIDENCE-FIELDS', p, `${x.kind} "${id}" needs the tested surface`);
  }

  const referenced = new Set();
  const ref = (id, path) => {
    referenced.add(id);
    if (!evidence.has(id)) add('EVIDENCE-REF', path, `unknown evidence "${id}"`);
  };

  // Products: lifecycle, and that some row uses each one.
  const usedProducts = new Set();
  for (const [id, { x, i }] of products) {
    const lc = obj(x.lifecycle);
    const p = `$.products[${i}].lifecycle`;
    arr(lc.evidence).forEach((e, j) => ref(e, `${p}.evidence[${j}]`));
    if (lc.status && lc.status !== 'active') {
      if (blank(lc.note)) add('LEGACY', p, `"${id}" is ${lc.status} but gives no note`);
      if (arr(lc.evidence).length === 0) add('LEGACY', p, `"${id}" is ${lc.status} but cites no evidence`);
    }
  }
  const productOf = (row) => products.get(row.product)?.x;
  const inactive = (row) => {
    const status = obj(productOf(row)?.lifecycle).status;
    return status && status !== 'active' ? `${row.product} is ${status}` : null;
  };

  for (const [id, { x: row, i }] of rows) {
    const p = `$.rows[${i}]`;
    const product = productOf(row);
    if (!product) {
      add('PRODUCT-REF', `${p}.product`, `unknown product "${row.product}"`);
    } else {
      usedProducts.add(row.product);
      if (!arr(product.families).includes(row.family)) add('PRODUCT-REF', `${p}.family`, `product "${row.product}" does not list family "${row.family}"`);
      const kinds = arr(row.kind);
      if (product.type === 'hardware' && !(kinds.length === 1 && kinds[0] === 'hardware')) add('PRODUCT-REF', `${p}.kind`, 'a hardware row has the kind ["hardware"] only');
      if (product.type === 'software' && kinds.some((k) => !arr(product.kinds).includes(k))) add('PRODUCT-REF', `${p}.kind`, `kinds not offered by product "${row.product}"`);
    }

    // Connection path: a via row is a hardware device reached through a direct software-wallet row
    // of the same family.
    const path = obj(row.path);
    let expectedId = `${row.product}--${row.family}`;
    let hostRow = null;
    if (path.type === 'via') {
      hostRow = rows.get(path.host)?.x;
      if (!hostRow) add('VIA-HOST', `${p}.path.host`, `"${id}" goes through "${path.host}", which is not a row`);
      else {
        const hostProduct = productOf(hostRow);
        if (obj(hostRow.path).type !== 'direct') add('VIA-HOST', `${p}.path.host`, `host "${path.host}" is not a direct row`);
        if (hostProduct?.type !== 'software') add('VIA-HOST', `${p}.path.host`, `host "${path.host}" is not a software wallet`);
        if (hostRow.family !== row.family) add('VIA-HOST', `${p}.path.host`, `host "${path.host}" is a ${hostRow.family} row, not ${row.family}`);
        expectedId += `--via-${hostRow.product}`;
      }
      if (product && product.type !== 'hardware') add('VIA-HOST', `${p}.product`, `only a hardware device is reached through a software wallet; "${row.product}" is ${product.type}`);
    }
    if (id !== expectedId && (path.type !== 'via' || hostRow)) add('ROW-ID', `${p}.id`, `expected id "${expectedId}"`);

    // Cells: every capability, each with a value, a reason and evidence.
    const cells = obj(row.cells);
    const kinds = new Set();
    for (const cap of CAPABILITIES) {
      const c = cells[cap];
      const cp = `${p}.cells["${cap}"]`;
      if (!c || typeof c !== 'object') { add('CELL-MISSING', cp, `no "${cap}" cell`); continue; }
      if (!VALUES.includes(c.value)) add('CELL-VALUE', `${cp}.value`, `no valid value (found ${JSON.stringify(c.value)})`);
      if (blank(c.reason)) add('CELL-REASON', `${cp}.reason`, 'no reason');
      const ev = arr(c.evidence);
      if (ev.length === 0) add('CELL-EVIDENCE', `${cp}.evidence`, 'no evidence');
      ev.forEach((e, j) => {
        ref(e, `${cp}.evidence[${j}]`);
        const k = evidence.get(e)?.x.kind;
        if (k) kinds.add(k);
      });
      // Operations on chain are known only from a run in this workspace.
      if (cap === 'on-chain' && c.value && c.value !== 'not-yet-measured' && !ev.some((e) => evidence.get(e)?.x.kind === 'workspace-test')) {
        add('ON-CHAIN', `${cp}.value`, `"${c.value}" needs a workspace-test run as evidence`);
      }
    }
    for (const key of Object.keys(cells)) if (!CAPABILITIES.includes(key)) add('CELL-MISSING', `${p}.cells`, `unknown capability "${key}"`);

    // Row state and group.
    if ((row.state === 'tested') !== (row.group === 'tested')) add('STATE-TESTED', `${p}.group`, `state "${row.state}" and group "${row.group}" disagree`);
    if (row.state === 'tested' && ![...kinds].some((k) => FIRST_HAND.has(k))) add('STATE-TESTED', `${p}.state`, 'a tested row needs a workspace-test or emulator-vector item among its evidence');

    // Legacy: a row is legacy exactly when its product, or the wallet it goes through, is no longer active.
    const why = inactive(row) ?? (hostRow ? inactive(hostRow) && `its host ${inactive(hostRow)}` : null);
    if (why && row.state !== 'legacy') add('LEGACY', `${p}.state`, `must be marked legacy: ${why}`);
    if (!why && row.state === 'legacy') add('LEGACY', `${p}.state`, 'marked legacy, but neither its product nor its host has a non-active lifecycle');
  }

  for (const [id, { i }] of products) if (!usedProducts.has(id)) add('PRODUCT-REF', `$.products[${i}]`, `product "${id}" has no row`);
  const combos = new Map();
  for (const [id, { x: row }] of rows) {
    const key = `${row.product}|${row.family}|${obj(row.path).type}|${obj(row.path).host ?? ''}`;
    if (combos.has(key)) add('DUP-ID', `$.rows (${id})`, `same product, family and path as "${combos.get(key)}"`);
    else combos.set(key, id);
  }
  for (const [id, { i }] of evidence) if (!referenced.has(id)) add('EVIDENCE-ORPHAN', `$.evidence[${i}]`, `evidence "${id}" is not cited by any cell or lifecycle`);
  return errors;
}

// ---------------------------------------------------------------------------------------------

export function summarize(data) {
  const rows = arr(data.rows);
  const tally = (keyOf) => rows.reduce((m, r) => { const k = keyOf(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const cellTally = (keyOf) => {
    const m = {};
    for (const r of rows) for (const cap of CAPABILITIES) {
      const c = obj(r.cells)[cap];
      if (!c) continue;
      const k = keyOf(r, cap, c.value);
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const products = new Map(arr(data.products).map((p) => [p.id, p]));
  const typeOf = (r) => products.get(r.product)?.type ?? 'unknown';
  return {
    products: arr(data.products).length,
    rows: rows.length,
    cells: rows.length * CAPABILITIES.length,
    evidence: arr(data.evidence).length,
    rowsByFamily: tally((r) => r.family),
    rowsByState: tally((r) => r.state),
    rowsByPath: tally((r) => `${typeOf(r)} ${obj(r.path).type}`),
    rowsByFamilyAndState: tally((r) => `${r.family} ${r.state}`),
    cellsByValue: cellTally((r, cap, v) => v),
    cellsByFamilyAndValue: cellTally((r, cap, v) => `${r.family} ${v}`),
    cellsByCapabilityAndValue: cellTally((r, cap, v) => `${cap} ${v}`),
    evidenceByKind: arr(data.evidence).reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {}),
  };
}

export function validate({ data, schema, allowlist }) {
  checkSchemaKeywords(schema);
  return [
    ...validateSchema(schema, data),
    ...checkRules(obj(data)),
    ...scanKeyMaterial(data, Array.isArray(allowlist) ? allowlist : []),
  ];
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (['--data', '--schema', '--allowlist'].includes(a) && argv[i + 1]) opts[a.slice(2)] = resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function main() {
  let opts, input;
  try {
    opts = parseArgs(process.argv.slice(2));
    input = {
      data: JSON.parse(readFileSync(opts.data, 'utf8')),
      schema: JSON.parse(readFileSync(opts.schema, 'utf8')),
      allowlist: JSON.parse(readFileSync(opts.allowlist, 'utf8')),
    };
  } catch (e) {
    console.error(`validate: ${e.message}`);
    process.exit(2);
  }
  let errors;
  try {
    errors = validate(input);
  } catch (e) {
    console.error(`validate: ${e.message}`);
    process.exit(2);
  }
  const summary = summarize(obj(input.data));
  if (opts.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors, summary }, null, 2));
  } else {
    for (const e of errors) console.log(`ERROR [${e.rule}] ${e.path}: ${e.message}`);
    console.log(JSON.stringify(summary, null, 2));
    console.log(errors.length === 0 ? `PASS: ${opts.data}` : `FAIL: ${errors.length} error(s) in ${opts.data}`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
