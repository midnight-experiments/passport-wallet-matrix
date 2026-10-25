import test from 'node:test';
import assert from 'node:assert/strict';
import { testEvm, eip1193Adapter, verifyEvmAnswer, evmProbeRequests } from '../../src/probe/evm.js';
import { liveCells } from '../../src/probe/verdict.js';
import { checkEip712V1TypedData, EIP712_V1_VERIFYING_CONTRACT, parseEvmAddress } from '../../src/vendor.js';
import { evmProvider, addressOf } from '../helpers/evm-wallet.mjs';
import { testSecp256k1 } from '../helpers/keys.mjs';

const run = async (opts, others) => {
  const p = evmProvider(opts);
  const t = await testEvm(eip1193Adapter(p, { others }));
  return { p, t, cells: liveCells('evm', t.steps, { standard: 'EIP-6963' }) };
};
const outcome = (t, id) => t.steps.find((s) => s.id === id)?.outcome;

test('the probe asks for the fixed V1 domain without chainId, and for the blind request of the probe network', () => {
  const addr = parseEvmAddress('0x1111111111111111111111111111111111111111');
  const r = evmProbeRequests(addr);
  checkEip712V1TypedData(r.typed.typedData);
  assert.deepEqual(Object.keys(r.typed.typedData.domain).sort(), ['name', 'verifyingContract', 'version']);
  assert.equal(r.typed.typedData.domain.verifyingContract, EIP712_V1_VERIFYING_CONTRACT);
  assert.equal(r.typed.typedData.primaryType, 'RotateEncKey');
  const text = new TextDecoder().decode(Buffer.from(r.personal.messageHex, 'hex'));
  assert.match(text, /^Midnight Passport account privacy key \(v1\)\nNetwork: wallet-matrix-probe\nWallet: Ethereum address 0x1111111111111111111111111111111111111111\nAccount index: 0\n/);
});

test('a deterministic wallet: every step verifies, check on connects, format and determinism', async () => {
  const { t, cells } = await run({});
  assert.deepEqual(t.steps.map((s) => [s.id, s.outcome]), [['connect', 'ok'], ['typed#1', 'verified'], ['typed#2', 'verified'], ['personal#1', 'verified'], ['personal#2', 'verified']]);
  assert.equal(cells.connects.value, 'check');
  assert.equal(cells['signs-format'].value, 'check');
  assert.equal(cells.deterministic.value, 'check');
  assert.equal(t.reported.clientVersion, 'TestWallet/v1.0.0');
  assert.equal(t.reported.chainId, '0xaa36a7');
});

test('a hedged wallet signs validly but never twice the same: determinism is a cross', async () => {
  const { t, cells } = await run({ mode: 'hedged' });
  assert.equal(outcome(t, 'typed#2'), 'verified');
  assert.equal(t.steps.find((s) => s.id === 'typed#2').sameAsFirst, false);
  assert.equal(cells['signs-format'].value, 'check');
  assert.equal(cells.deterministic.value, 'cross');
});

test('a wallet that adds its chainId to the domain: wrong format, explained', async () => {
  const { t, cells } = await run({ mode: 'chainid' });
  assert.equal(outcome(t, 'typed#1'), 'wrong-signature');
  assert.match(t.steps.find((s) => s.id === 'typed#1').reason, /chainId 11155111 added to the domain/);
  assert.equal(outcome(t, 'personal#1'), 'verified');
  assert.equal(cells['signs-format'].value, 'cross');
});

test('a wallet answering with another wallet\'s key: refused, and the other wallet is named', async () => {
  const other = addressOf(testSecp256k1('evm other'));
  const { t, cells } = await run({ mode: 'other-key' }, async () => [other]);
  const s = t.steps.find((x) => x.id === 'typed#1');
  assert.equal(s.outcome, 'wrong-signature');
  assert.ok(s.signer && s.signer.toLowerCase() === '0x' + Buffer.from(other).toString('hex'));
  assert.equal(cells['signs-format'].value, 'cross');
});

test('the same answer with no candidate list: the signer is unknown', async () => {
  const { t } = await run({ mode: 'other-key' });
  const s = t.steps.find((x) => x.id === 'typed#1');
  assert.equal(s.outcome, 'wrong-signature');
  assert.equal(s.signer, undefined);
  assert.match(s.reason, /signer is unknown/);
});

test('a refused typed-data request is not asked again; personal_sign still decides a warning', async () => {
  const { p, t, cells } = await run({ mode: 'refuse-typed' });
  assert.equal(outcome(t, 'typed#1'), 'refused');
  assert.equal(outcome(t, 'typed#2'), 'skipped');
  assert.equal(p.calls.filter((c) => c === 'eth_signTypedData_v4').length, 1);
  assert.equal(cells['signs-format'].value, 'warning');
  assert.equal(cells.deterministic.value, 'check');
});

test('a Ledger-style 0x6a80 refusal is recorded with its status and shown as a warning', async () => {
  const { t, cells } = await run({ mode: 'ledger-6a80' });
  const s = t.steps.find((x) => x.id === 'typed#1');
  assert.equal(s.outcome, 'refused');
  assert.equal(s.status, '6a80');
  assert.equal(cells['signs-format'].value, 'warning');
  assert.match(cells['signs-format'].reason, /blind signing/);
});

test('a contract-account signature cannot be checked by key recovery', async () => {
  const { t } = await run({ mode: 'smart' });
  assert.equal(outcome(t, 'typed#1'), 'wrong-signature');
  assert.match(t.steps.find((x) => x.id === 'typed#1').reason, /contract account/);
});

test('a refused connection stops the test', async () => {
  const { t, cells } = await run({ mode: 'refuse-connect' });
  assert.equal(t.steps.length, 1);
  assert.equal(cells.connects.value, 'cross');
  assert.equal(cells['signs-format'].value, 'not-yet-measured');
});

test('verifyEvmAnswer refuses typed data outside the V1 domain before any recovery', async () => {
  const { t } = await run({});
  const s = t.steps.find((x) => x.id === 'typed#1');
  const td = structuredClone(s.request.typedData);
  td.domain.name = 'Another dApp';
  const r = verifyEvmAnswer({ type: 'typed-data', typedData: td }, s.signature, t.identity.address);
  assert.equal(r.outcome, 'wrong-signature');
  assert.match(r.reason, /not one the client sends/);
});
