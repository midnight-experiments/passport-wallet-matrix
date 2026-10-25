import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { testSolana } from '../../src/probe/solana.js';
import { liveCells } from '../../src/probe/verdict.js';
import { SOL_RAW_HEAD } from '../../src/vendor.js';
import { fromHex, base58Encode } from '../../src/bytes.js';
import { solWallet, solKey } from '../helpers/sol-wallet.mjs';
import { testSeed } from '../helpers/keys.mjs';

const run = async (opts, runOpts = {}) => {
  const w = solWallet(opts);
  const t = await testSolana({ kind: 'standard', wallet: w }, runOpts);
  return { w, t, cells: liveCells('solana', t.steps, { standard: 'Wallet Standard' }) };
};
const ids = (t) => t.steps.map((s) => [s.id, s.outcome]);

test('Phantom (named, raw only): never probed, signs the probe raw, then the blind request twice raw', async () => {
  const { w, t, cells } = await run({ name: 'Phantom', offchain: [1] });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:raw', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.equal(t.reported.probe.probed, false);
  assert.ok(!w.calls.includes('signOffchainMessage'), 'Phantom is never asked for off-chain, whatever it advertises');
  assert.equal(t.reported.enrolmentFormat, 'raw');
  const probe = new TextDecoder().decode(fromHex(t.steps[1].request.bytesHex));
  assert.ok(probe.startsWith(SOL_RAW_HEAD + 'Midnight Passport signing format check (sol v1)\n'));
  const blind = new TextDecoder().decode(fromHex(t.steps[2].request.bytesHex));
  assert.match(blind, /^Midnight Passport account privacy key \(v1\)\nNetwork: wallet-matrix-probe\n/);
  assert.equal(cells['signs-format'].value, 'check');
  assert.equal(cells.deterministic.value, 'check');
});

test('Backpack (named): off-chain v1 first when advertised', async () => {
  const { w, t, cells } = await run({ name: 'Backpack', offchain: [0, 1] });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:offchain', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.ok(!w.calls.includes('signMessage'));
  assert.equal(cells['signs-format'].value, 'check');
  assert.deepEqual(t.reported.supportedMessageVersions, [0, 1]);
});

test('Backpack advertising only off-chain v0 is asked raw: supportedMessageVersions is read first', async () => {
  const { w, t } = await run({ name: 'Backpack', offchain: [0] });
  assert.deepEqual(t.reported.formats, ['raw']);
  assert.ok(!w.calls.includes('signOffchainMessage'));
  assert.equal(t.steps[1].id, 'probe:raw');
});

test('another wallet: the probe asks raw first and stops when it verifies', async () => {
  const { w, t } = await run({ name: 'Some Wallet', offchain: [1] });
  assert.equal(t.reported.probe.probed, true);
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:raw', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.ok(!w.calls.includes('signOffchainMessage'));
});

test('another wallet that refuses raw: the probe moves to off-chain v1', async () => {
  const { t, cells } = await run({ name: 'Some Wallet', offchain: [1], mode: 'refuse-raw' });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:raw', 'refused'], ['probe:offchain', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.equal(t.reported.enrolmentFormat, 'offchain');
  assert.equal(cells['signs-format'].value, 'check');
});

test('another wallet that signs the raw text without the head: wrong signature, then off-chain', async () => {
  const { t, cells } = await run({ name: 'Some Wallet', offchain: [1], mode: 'no-head' });
  assert.equal(t.steps.find((s) => s.id === 'probe:raw').outcome, 'wrong-signature');
  assert.equal(t.steps.find((s) => s.id === 'probe:offchain').outcome, 'verified');
  assert.equal(cells['signs-format'].value, 'warning');
});

test('a wallet that answers an off-chain request with a v0 envelope is refused by the adapter', async () => {
  const { t, cells } = await run({ name: 'Some Wallet', raw: false, offchain: [1], mode: 'v0' });
  assert.equal(t.steps.find((s) => s.id === 'probe:offchain').outcome, 'refused');
  assert.match(t.steps.find((s) => s.id === 'probe:offchain').reason, /another off-chain message/);
  assert.equal(cells['signs-format'].value, 'cross');
  assert.equal(cells.deterministic.value, 'not-yet-measured');
});

test('a hedged signer: valid signatures that never repeat', async () => {
  const { t, cells } = await run({ name: 'Phantom', mode: 'hedged' });
  assert.equal(t.steps.find((s) => s.id === 'blind#2').outcome, 'verified');
  assert.equal(t.steps.find((s) => s.id === 'blind#2').sameAsFirst, false);
  assert.equal(cells.deterministic.value, 'cross');
});

test('a wallet answering with another wallet\'s key is refused, naming that wallet', async () => {
  const other = solKey('sol other');
  const { t, cells } = await run({ name: 'Phantom', mode: 'other-key' }, { others: () => [other] });
  const s = t.steps.find((x) => x.id === 'probe:raw');
  assert.equal(s.outcome, 'wrong-signature');
  assert.equal(s.signer, base58Encode(other));
  assert.equal(cells['signs-format'].value, 'cross');
});

test('a wallet with no signing feature is asked nothing', async () => {
  const { w, t, cells } = await run({ name: 'Some Wallet', raw: false, offchain: null });
  assert.deepEqual(w.calls, []);
  assert.equal(cells['signs-format'].value, 'not-yet-measured');
});

test('a hardware source signs off-chain v1 only', async () => {
  const seed = testSeed('sol hardware');
  const publicKey = ed25519.getPublicKey(seed);
  let asked = [];
  const t = await testSolana({ kind: 'hardware', family: 'ledger', publicKey, signOffchain: (env) => { asked.push(env[0]); return ed25519.sign(env, seed); } });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:offchain', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.ok(asked.every((b) => b === 0xff));
  assert.equal(liveCells('solana', t.steps).deterministic.value, 'check');
});

test('a Trezor-style source that reports other signed bytes is refused', async () => {
  const seed = testSeed('sol hardware');
  const publicKey = ed25519.getPublicKey(seed);
  const t = await testSolana({ kind: 'hardware', family: 'trezor', publicKey, signOffchain: (env, text) => ({ signature: ed25519.sign(env, seed), signed: text }) });
  assert.equal(t.steps.find((s) => s.id === 'probe:offchain').outcome, 'refused');
  assert.match(t.steps.find((s) => s.id === 'probe:offchain').reason, /another off-chain message/);
});
