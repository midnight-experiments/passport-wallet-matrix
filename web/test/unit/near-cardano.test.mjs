import test from 'node:test';
import assert from 'node:assert/strict';
import { testNear } from '../../src/probe/near.js';
import { testCardano } from '../../src/probe/cardano.js';
import { liveCells } from '../../src/probe/verdict.js';
import { CARDANO_X, oneLine, nearBlindNonce, NEAR_BLIND_RECIPIENT, pad32, NEAR_BLIND_NONCE_TAG, NEAR_DEVICE_NONCE_TAG } from '../../src/probe/provisional.js';
import { fromHex, utf8 } from '../../src/bytes.js';
import { nearWallet } from '../helpers/near-wallet.mjs';
import { cip30Wallet } from '../helpers/cip30-wallet.mjs';

const PAGE = 'https://passport-wallet-matrix.test/#/test';
const ids = (t) => t.steps.map((s) => [s.id, s.outcome]);

test('the provisional constants: 32-byte tags and prefix, one-line texts', () => {
  assert.equal(utf8(CARDANO_X).length, 32);
  assert.ok(!CARDANO_X.includes('\n'));
  assert.equal(utf8(NEAR_BLIND_NONCE_TAG).length, 32);
  assert.equal(utf8(NEAR_DEVICE_NONCE_TAG).length, 32);
  assert.throws(() => pad32('x'.repeat(33)));
  assert.throws(() => oneLine(['a', ' b']));
  assert.throws(() => oneLine(['a\nb']));
  assert.equal(nearBlindNonce(0).length, 32);
});

test('NEAR: a good wallet signs NEP-413 with callbackUrl absent, twice the same', async () => {
  const t = await testNear(nearWallet(), { pageUrl: PAGE });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  const blind = t.steps.find((s) => s.id === 'blind#1');
  assert.equal(blind.request.recipient, NEAR_BLIND_RECIPIENT);
  assert.match(blind.request.message, /^Midnight Passport account privacy key \(v1\) \| Network: wallet-matrix-probe \| Wallet: NEAR public key ed25519:/);
  assert.equal(t.steps.find((s) => s.id === 'probe').request.recipient.length, 64);
  const c = liveCells('near', t.steps);
  assert.equal(c['signs-format'].value, 'check');
  assert.equal(c.deterministic.value, 'check');
  assert.match(t.reported.provisional, /Provisional/);
});

test('NEAR: a wallet that signs with callbackUrl set is refused, explained', async () => {
  const t = await testNear(nearWallet({ mode: 'callback', callbackUrl: PAGE }), { pageUrl: PAGE });
  const s = t.steps.find((x) => x.id === 'probe');
  assert.equal(s.outcome, 'wrong-signature');
  assert.match(s.reason, /callbackUrl set/);
  assert.equal(liveCells('near', t.steps)['signs-format'].value, 'cross');
  assert.equal(t.steps.length, 2, 'no key, no blind request');
});

test('NEAR: a hedged signer is not deterministic; a key change is caught', async () => {
  const h = await testNear(nearWallet({ mode: 'hedged' }), { pageUrl: PAGE });
  assert.equal(liveCells('near', h.steps).deterministic.value, 'cross');
  const o = await testNear(nearWallet({ mode: 'other-key' }), { pageUrl: PAGE });
  assert.equal(o.steps.find((s) => s.id === 'blind#1').outcome, 'wrong-signature');
  assert.match(o.steps.find((s) => s.id === 'blind#1').reason, /not the key/);
});

test('NEAR: a refusal is recorded and nothing else is asked', async () => {
  const t = await testNear(nearWallet({ mode: 'refuse' }), { pageUrl: PAGE });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe', 'refused']]);
  assert.equal(liveCells('near', t.steps)['signs-format'].value, 'cross');
});

test('Cardano layout 1: the text, then X and the text, then the blind request twice', async () => {
  const w = cip30Wallet({ layout: 1 });
  const t = await testCardano(null, { enable: () => w.enable() });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:text', 'verified'], ['probe:x-text', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  const x = new TextDecoder().decode(fromHex(t.steps.find((s) => s.id === 'probe:x-text').request.payloadHex));
  assert.ok(x.startsWith(CARDANO_X + 'Midnight Passport signing format check (cardano v1) | '));
  assert.ok(x.length - 32 >= 256);
  const blind = new TextDecoder().decode(fromHex(t.steps.find((s) => s.id === 'blind#1').request.payloadHex));
  assert.ok(blind.startsWith('Midnight Passport account privacy key (v1) | Network: wallet-matrix-probe | Wallet: Cardano key '));
  assert.ok(!blind.includes(CARDANO_X));
  const c = liveCells('cardano', t.steps);
  assert.equal(c['signs-format'].value, 'check');
  assert.match(c['signs-format'].reason, /layout 1/);
  assert.equal(c.deterministic.value, 'check');
  assert.equal(t.reported.layout, 1);
  assert.equal(t.reported.testOnly, 'test only, address not bound');
});

test('Cardano layout 2 (Lace): the text alone is the approval form; X is never sent', async () => {
  const w = cip30Wallet({ name: 'lace', layout: 2 });
  const t = await testCardano(null, { enable: () => w.enable() });
  assert.deepEqual(ids(t), [['connect', 'ok'], ['probe:text', 'verified'], ['blind#1', 'verified'], ['blind#2', 'verified']]);
  assert.equal(liveCells('cardano', t.steps)['signs-format'].value, 'check');
});

test('Cardano: a hashed payload is refused', async () => {
  const w = cip30Wallet({ mode: 'hashed' });
  const t = await testCardano(null, { enable: () => w.enable() });
  const s = t.steps.find((x) => x.id === 'probe:text');
  assert.equal(s.outcome, 'wrong-signature');
  assert.match(s.reason, /payload is hashed \(BLAKE2b-224/);
  assert.equal(liveCells('cardano', t.steps)['signs-format'].value, 'cross');
});

test('Cardano: a header naming another address is refused', async () => {
  const w = cip30Wallet({ mode: 'other-address' });
  const t = await testCardano(null, { enable: () => w.enable() });
  assert.equal(t.steps.find((x) => x.id === 'probe:text').outcome, 'wrong-signature');
  assert.match(t.steps.find((x) => x.id === 'probe:text').reason, /not an accepted layout/);
});

test('Cardano: hedged signatures and a key change', async () => {
  const h = await testCardano(null, { enable: () => cip30Wallet({ mode: 'hedged', layout: 2 }).enable() });
  assert.equal(liveCells('cardano', h.steps).deterministic.value, 'cross');
  const o = await testCardano(null, { enable: () => cip30Wallet({ mode: 'other-key', layout: 2 }).enable() });
  assert.equal(o.steps.find((s) => s.id === 'blind#1').outcome, 'wrong-signature');
  assert.match(o.steps.find((s) => s.id === 'blind#1').reason, /another key/);
});

test('Cardano: a declined request (CIP-30 code 3) is a refusal', async () => {
  const t = await testCardano(null, { enable: () => cip30Wallet({ mode: 'refuse' }).enable() });
  assert.equal(t.steps.find((s) => s.id === 'probe:text').outcome, 'refused');
  assert.match(t.steps.find((s) => s.id === 'probe:text').reason, /code 3/);
});
