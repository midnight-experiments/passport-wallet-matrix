import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../../../data/wallets.json';
import { buildModel } from '../../src/data/model.js';
import { makeResult, exportResult, importResult, withReadable, resultFileName } from '../../src/probe/result.js';
import { testEvm, eip1193Adapter } from '../../src/probe/evm.js';
import { testSolana } from '../../src/probe/solana.js';
import { testNear } from '../../src/probe/near.js';
import { testCardano } from '../../src/probe/cardano.js';
import { evmProvider } from '../helpers/evm-wallet.mjs';
import { solWallet } from '../helpers/sol-wallet.mjs';
import { nearWallet } from '../helpers/near-wallet.mjs';
import { cip30Wallet } from '../helpers/cip30-wallet.mjs';

const model = buildModel(data);
const wallet = (name, standard, productId) => ({ standard, reported: { key: `x:${name}`, name, standard, productId }, surface: { product: name } });

async function results() {
  return {
    evm: makeResult({ family: 'evm', test: await testEvm(eip1193Adapter(evmProvider())), wallet: wallet('MetaMask', 'EIP-6963', 'metamask'), baselineView: model.views.get('metamask--evm') }),
    evmHedged: makeResult({ family: 'evm', test: await testEvm(eip1193Adapter(evmProvider({ mode: 'hedged' }))), wallet: wallet('Odd', 'EIP-6963', null) }),
    solana: makeResult({ family: 'solana', test: await testSolana({ kind: 'standard', wallet: solWallet({ name: 'Phantom' }) }), wallet: wallet('Phantom', 'Wallet Standard', 'phantom'), baselineView: model.views.get('phantom--solana') }),
    near: makeResult({ family: 'near', test: await testNear(nearWallet(), { pageUrl: 'https://x.test/' }), wallet: wallet('Meteor Wallet', 'NEAR wallet selector', 'meteor'), baselineView: model.views.get('meteor--near') }),
    cardano: makeResult({ family: 'cardano', test: await testCardano(null, { enable: () => cip30Wallet().enable() }), wallet: wallet('eternl', 'CIP-30', 'eternl'), baselineView: model.views.get('eternl--cardano') }),
  };
}

test('every family\'s result round-trips: export, import, the same verdict and the same file', async () => {
  for (const [name, r] of Object.entries(await results())) {
    const text = exportResult(r);
    const back = importResult(text, r.comparison.rowId ? model.views.get(r.comparison.rowId) : null);
    assert.deepEqual(back.cells, r.cells, name);
    assert.deepEqual(back.comparison, r.comparison, name);
    assert.equal(exportResult(back), text, name);
  }
});

test('a result records the wallet surface, the methods, the formats and the verdict', async () => {
  const { evm, solana, cardano } = await results();
  assert.equal(evm.format, 'passport-wallet-matrix/live-result');
  assert.equal(evm.arm, 'evm_k256');
  assert.equal(evm.wallet.surface.product, 'MetaMask');
  assert.deepEqual(evm.steps.map((s) => s.method).filter(Boolean), ['eth_signTypedData_v4', 'eth_signTypedData_v4', 'personal_sign', 'personal_sign']);
  assert.deepEqual([...new Set(evm.steps.map((s) => s.format).filter(Boolean))], ['eip712-v1', 'personal_sign']);
  assert.equal(solana.reported.enrolmentFormat, 'raw');
  assert.equal(cardano.provisional, true);
  assert.equal(cardano.testOnly, 'test only, address not bound');
  assert.match(resultFileName(evm), /^wallet-matrix-evm-metamask-.*\.json$/);
});

test('a changed signature is refused on import', async () => {
  const { evm } = await results();
  const f = JSON.parse(exportResult(evm));
  const s = f.steps.find((x) => x.id === 'typed#1');
  s.signature = s.signature.slice(0, 10) + (s.signature[10] === 'a' ? 'b' : 'a') + s.signature.slice(11);
  assert.throws(() => importResult(JSON.stringify(f)), /does not follow from its signature/);
});

test('a changed verdict is refused on import', async () => {
  const { evmHedged } = await results();
  assert.equal(evmHedged.cells.deterministic.value, 'cross');
  const f = JSON.parse(exportResult(evmHedged));
  f.cells.deterministic = { value: 'check', reason: 'every request signed twice gave the same signature' };
  assert.throws(() => importResult(JSON.stringify(f)), /recorded verdict does not follow/);
});

test('a changed outcome is refused on import, even with a matching verdict', async () => {
  const { solana } = await results();
  const f = JSON.parse(exportResult(solana));
  f.steps.find((x) => x.id === 'blind#2').sameAsFirst = false;
  f.cells.deterministic = { value: 'cross', reason: 'x' };
  assert.throws(() => importResult(JSON.stringify(f)), /does not follow/);
});

test('a changed request is refused on import: the signature no longer verifies over it', async () => {
  const { cardano } = await results();
  const f = JSON.parse(exportResult(cardano));
  const s = f.steps.find((x) => x.id === 'probe:x-text');
  s.request.payloadHex = s.request.payloadHex.slice(0, -2) + '21';
  assert.throws(() => importResult(JSON.stringify(f)), /does not follow/);
});

test('other files are refused: not JSON, another format, another version, a wrong arm', async () => {
  const { near } = await results();
  assert.throws(() => importResult('{'), /not JSON/);
  assert.throws(() => importResult(JSON.stringify({ ...near, format: 'x' })), /not a passport-wallet-matrix/);
  assert.throws(() => importResult(JSON.stringify({ ...near, version: 2 })), /version 2/);
  assert.throws(() => importResult(JSON.stringify({ ...near, arm: 'sol_ed25519' })), /family and arm/);
  assert.throws(() => importResult(JSON.stringify({ ...near, readable: 'maybe' })), /readable answer/);
});

test('the readable answer changes only the readable cell and the comparison', async () => {
  const { evm } = await results();
  const r = withReadable(evm, 'partly', model.views.get('metamask--evm'));
  assert.equal(r.cells.readable.value, 'warning');
  assert.equal(r.comparison.perCapability.readable.verdict, 'same');
  const r2 = withReadable(evm, 'yes', model.views.get('metamask--evm'));
  assert.deepEqual(r2.comparison.differs, ['readable']);
  assert.deepEqual(importResult(exportResult(r2), model.views.get('metamask--evm')).cells, r2.cells);
  assert.throws(() => withReadable(evm, 'maybe'));
});
