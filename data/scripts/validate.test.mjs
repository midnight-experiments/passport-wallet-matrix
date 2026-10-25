// Tests for validate.mjs: the curated data passes, and each rule fails on a deliberately broken
// copy. The broken copies are written to a fresh temporary folder outside the repository and
// removed afterwards. Run: node --test data/scripts/validate.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, checkSchemaKeywords, validateSchema } from './validate.mjs';

const SCRIPT = fileURLToPath(new URL('./validate.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'wallet-matrix-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
const base = () => load(DEFAULTS.data);
let n = 0;

function run(data, allowlist) {
  const file = join(scratch, `data-${n++}.json`);
  writeFileSync(file, JSON.stringify(data));
  const args = [SCRIPT, '--data', file, '--json'];
  if (allowlist) {
    const a = join(scratch, `allowlist-${n++}.json`);
    writeFileSync(a, JSON.stringify(allowlist));
    args.push('--allowlist', a);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.ok(r.stdout, `no output; stderr: ${r.stderr}`);
  return { status: r.status, ...JSON.parse(r.stdout) };
}

function expectRule(mutate, rule, { allowlist, match } = {}) {
  const data = base();
  mutate(data);
  const r = run(data, allowlist);
  assert.equal(r.status, 1, 'the broken copy must fail');
  const hits = r.errors.filter((e) => e.rule === rule);
  assert.ok(hits.length > 0, `expected a ${rule} error; got ${JSON.stringify(r.errors, null, 1)}`);
  if (match) assert.ok(hits.some((e) => match.test(e.message)), `no ${rule} message matches ${match}: ${JSON.stringify(hits)}`);
  return r.errors;
}

const row = (data, id) => {
  const r = data.rows.find((x) => x.id === id);
  assert.ok(r, `row ${id} exists in the curated data`);
  return r;
};
const product = (data, id) => data.products.find((x) => x.id === id);
const evidence = (data, id) => data.evidence.find((x) => x.id === id);
const addNote = (text) => (d) => { const r = row(d, 'trust--evm'); r.notes = [...(r.notes ?? []), text]; };

test('the curated data passes', () => {
  const r = run(base());
  assert.deepEqual(r.errors, []);
  assert.equal(r.status, 0);
  assert.equal(r.ok, true);
  assert.equal(r.summary.cells, r.summary.rows * 5);
});

// ---------------------------------------------------------------- every cell is complete
test('a missing reason fails', () => {
  expectRule((d) => { delete row(d, 'metamask--evm').cells.connects.reason; }, 'CELL-REASON');
});
test('a blank reason fails', () => {
  expectRule((d) => { row(d, 'metamask--evm').cells.readable.reason = '   '; }, 'CELL-REASON');
});
test('missing evidence fails', () => {
  expectRule((d) => { row(d, 'phantom--solana').cells.readable.evidence = []; }, 'CELL-EVIDENCE');
});
test('a missing capability cell fails', () => {
  expectRule((d) => { delete row(d, 'lace--cardano').cells.deterministic; }, 'CELL-MISSING');
});
test('a value outside the four fails', () => {
  expectRule((d) => { row(d, 'lace--cardano').cells.readable.value = 'maybe'; }, 'CELL-VALUE');
});
test('evidence that does not exist fails', () => {
  expectRule((d) => { row(d, 'eternl--cardano').cells.connects.evidence.push('ws-no-such-run'); }, 'EVIDENCE-REF');
});
test('evidence no cell cites fails', () => {
  expectRule((d) => { d.evidence.push({ ...evidence(d, 'res-trust-evm'), id: 'res-uncited' }); }, 'EVIDENCE-ORPHAN');
});
test('a research item without its source URL fails', () => {
  expectRule((d) => { delete evidence(d, 'res-trust-evm').url; }, 'EVIDENCE-FIELDS');
});
test('a workspace test without its tested surface fails', () => {
  expectRule((d) => { delete evidence(d, 'ws-lace-ada-2026-10-21').surface; }, 'EVIDENCE-FIELDS');
});

// ---------------------------------------------------------------- ids
test('a duplicate row id fails', () => {
  expectRule((d) => { d.rows.push(structuredClone(row(d, 'meteor--near'))); }, 'DUP-ID', { match: /duplicate id "meteor--near"/ });
});
test('a duplicate product id fails', () => {
  expectRule((d) => { d.products.push(structuredClone(product(d, 'meteor'))); }, 'DUP-ID', { match: /duplicate id "meteor"/ });
});
test('a duplicate evidence id fails', () => {
  expectRule((d) => { d.evidence.push(structuredClone(evidence(d, 'res-trust-evm'))); }, 'DUP-ID', { match: /duplicate id "res-trust-evm"/ });
});
test('a row id that does not follow product, family and path fails', () => {
  expectRule((d) => { row(d, 'trezor--near').id = 'trezor-near'; }, 'ROW-ID');
});

// ---------------------------------------------------------------- via rows
test('a dangling via fails', () => {
  expectRule((d) => { row(d, 'ledger--evm--via-metamask').path.host = 'no-such-wallet--evm'; }, 'VIA-HOST', { match: /not a row/ });
});
test('a via through a hardware row fails', () => {
  expectRule((d) => { row(d, 'ledger--evm--via-metamask').path.host = 'trezor--evm'; }, 'VIA-HOST', { match: /not a software wallet/ });
});
test('a via through another family fails', () => {
  expectRule((d) => { row(d, 'ledger--evm--via-metamask').path.host = 'phantom--solana'; }, 'VIA-HOST', { match: /solana row, not evm/ });
});
test('a software wallet reached through another wallet fails', () => {
  expectRule((d) => { row(d, 'rabby--evm').path = { type: 'via', host: 'metamask--evm' }; }, 'VIA-HOST', { match: /only a hardware device/ });
});

// ---------------------------------------------------------------- legacy
test('a legacy product whose row is not marked legacy fails', () => {
  expectRule((d) => { row(d, 'mynearwallet--near').state = 'documented'; }, 'LEGACY', { match: /must be marked legacy/ });
});
test('a row through a legacy wallet that is not marked legacy fails', () => {
  expectRule((d) => { row(d, 'ledger--cardano--via-secondfi').state = 'unconfirmed'; }, 'LEGACY', { match: /its host secondfi is ceasing/ });
});
test('a legacy mark without a non-active lifecycle fails', () => {
  expectRule((d) => { Object.assign(row(d, 'trust--evm'), { state: 'legacy' }); }, 'LEGACY', { match: /neither its product nor its host/ });
});
test('a non-active lifecycle without evidence fails', () => {
  expectRule((d) => { delete product(d, 'mynearwallet').lifecycle.evidence; }, 'LEGACY', { match: /cites no evidence/ });
});

// ---------------------------------------------------------------- states and the on-chain column
test('a tested row without a workspace or emulator run fails', () => {
  expectRule((d) => { Object.assign(row(d, 'trust--evm'), { state: 'tested', group: 'tested' }); }, 'STATE-TESTED', { match: /needs a workspace-test/ });
});
test('a state and group that disagree fail', () => {
  expectRule((d) => { row(d, 'meteor--near').group = 'researched'; }, 'STATE-TESTED');
});
test('an on-chain value without a workspace run fails', () => {
  expectRule((d) => { row(d, 'trust--evm').cells['on-chain'].value = 'check'; }, 'ON-CHAIN');
});

// ---------------------------------------------------------------- products and definitions
test('a row of an unknown product fails', () => {
  expectRule((d) => { row(d, 'trust--evm').product = 'no-such-product'; }, 'PRODUCT-REF', { match: /unknown product/ });
});
test('a row whose family its product does not list fails', () => {
  expectRule((d) => { product(d, 'trust').families = ['evm']; }, 'PRODUCT-REF', { match: /does not list family "solana"/ });
});
test('a product with no row fails', () => {
  expectRule((d) => { d.products.push({ ...structuredClone(product(d, 'vespr')), id: 'unused-wallet' }); }, 'PRODUCT-REF', { match: /has no row/ });
});
test('a missing capability definition fails', () => {
  expectRule((d) => { d.capabilities = d.capabilities.filter((c) => c.id !== 'readable'); }, 'DEFINITIONS');
});

// ---------------------------------------------------------------- the schema
test('an unexpected property fails the schema', () => {
  expectRule((d) => { row(d, 'trust--evm').publicKey = 'redacted'; }, 'SCHEMA', { match: /unexpected property "publicKey"/ });
});
test('a malformed date fails the schema', () => {
  expectRule((d) => { evidence(d, 'res-trust-evm').date = '25/10/2026'; }, 'SCHEMA', { match: /does not match/ });
});
test('a non-https source fails the schema', () => {
  expectRule((d) => { evidence(d, 'res-trust-evm').url = 'http://example.com/'; }, 'SCHEMA');
});
test('the schema checker refuses keywords it does not implement', () => {
  assert.throws(() => checkSchemaKeywords({ type: 'object', patternProperties: {} }), /unsupported schema keyword "patternProperties"/);
  assert.throws(() => checkSchemaKeywords({ type: 'object', additionalProperties: true }), /must be false/);
});
test('oneOf needs exactly one match', () => {
  const schema = { oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] };
  assert.equal(validateSchema(schema, 'x').length, 1);
  assert.equal(validateSchema(schema, '').length, 0);
});

// ---------------------------------------------------------------- key material (synthetic values)
const FAKE = {
  ethereum: ['0x' + '12ab'.repeat(10), /Ethereum address/],
  hex: ['c0ffee00'.repeat(4), /long hex run/],
  truncated: ['Signer a1b2c3d4e5f6…', /truncated hex/],
  base58: ['Zx9'.repeat(15), /base58/],
  bech32: ['addr_test1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(2), /Cardano bech32/],
  nearImplicit: ['ab'.repeat(32), /NEAR implicit/],
  base64: ['Ab3+'.repeat(22) + '==', /base64/],
  nearNamed: ['tester-1.testnet', /NEAR named account/],
};
for (const [name, [value, match]] of Object.entries(FAKE)) {
  test(`an injected ${name} value fails`, () => {
    expectRule(addNote(`See ${value} for details.`), 'KEY-MATERIAL', { match });
  });
}
test('an address inside a URL fails', () => {
  expectRule((d) => { evidence(d, 'res-trust-evm').url = `https://explorer.example/address/${FAKE.ethereum[0]}`; }, 'KEY-MATERIAL', { match: /Ethereum address/ });
});
test('the public store id needs its allowlist entry', () => {
  expectRule(() => {}, 'KEY-MATERIAL', { allowlist: [], match: /long hex run/ });
});
test('an allowlist entry without a reason fails', () => {
  expectRule(() => {}, 'ALLOWLIST', { allowlist: load(DEFAULTS.allowlist).map((e) => ({ value: e.value })), match: /has no reason/ });
});
test('an unused allowlist entry fails', () => {
  expectRule(() => {}, 'ALLOWLIST', { allowlist: [...load(DEFAULTS.allowlist), { value: 'not-in-the-data', reason: 'stale' }], match: /not used/ });
});
test('Chrome Web Store extension ids are not taken for keys', () => {
  // An id of 32 letters a to p without an 'l' is also a base58 run; the data must hold one for
  // this test to exercise the exception.
  const ids = [...JSON.stringify(base()).matchAll(/chromewebstore\.google\.com\/detail\/[^/"]+\/([a-p]{32})/g)].map((m) => m[1]);
  assert.ok(ids.some((id) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(id)), 'no extension id in the data is a full base58 run');
  assert.equal(run(base()).status, 0);
});
