import test from 'node:test';
import assert from 'node:assert/strict';
import { Detector } from '../../src/detect/index.js';
import { describeDetected } from '../../src/detect/common.js';
import { nearDetected, nearInjectedObjects } from '../../src/detect/near.js';
import { evmProvider } from '../helpers/evm-wallet.mjs';
import { solWallet } from '../helpers/sol-wallet.mjs';
import { cip30Wallet } from '../helpers/cip30-wallet.mjs';

/** A window: an event target with the globals wallets inject. */
const fakeWindow = (globals = {}) => Object.assign(new EventTarget(), globals);

/** An EIP-6963 wallet: answers every request for providers. */
function announce(win, info, provider) {
  const send = () => win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  win.addEventListener('eip6963:requestProvider', send);
  send();
}
/** A Wallet Standard wallet that loads before the page: it answers app-ready. */
function walletBefore(win, wallet) {
  win.addEventListener('wallet-standard:app-ready', (ev) => ev.detail.register(wallet));
}
/** A Wallet Standard wallet that loads after the page: it dispatches register-wallet. */
function walletAfter(win, wallet) {
  win.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api) => api.register(wallet) }));
}

test('EIP-6963: each announcement is a detected wallet, identified by its provider object', async () => {
  const win = fakeWindow();
  const mm = evmProvider({ flags: { isMetaMask: true } });
  const rabby = evmProvider({ label: 'evm two', flags: { isRabby: true, isMetaMask: true } });
  const det = new Detector(win);
  announce(win, { uuid: 'u-1', name: 'MetaMask', rdns: 'io.metamask', icon: 'data:image/svg+xml,x' }, mm);
  announce(win, { uuid: 'u-2', name: 'Rabby Wallet', rdns: 'io.rabby', icon: 'data:image/svg+xml,x' }, rabby);
  const list = (await det.detect({ waitMs: 5 })).filter((d) => d.family === 'evm');
  assert.equal(list.length, 2);
  const a = list.find((d) => d.name === 'MetaMask');
  const b = list.find((d) => d.name === 'Rabby Wallet');
  assert.equal(a.productId, 'metamask');
  assert.equal(a.productBy, 'rdns');
  assert.equal(b.productId, 'rabby');
  assert.notEqual(a.objectId, b.objectId);
  assert.deepEqual(a.warnings, []);
  assert.ok(b.notes.some((n) => /isMetaMask/.test(n)), 'a compatibility flag is a note, not a claim');
  assert.equal(a.object, mm);
  assert.ok(!('object' in JSON.parse(JSON.stringify(a))), 'the live object never reaches a file');
});

test('EIP-6963: one provider object announced under two names is flagged on both', async () => {
  const win = fakeWindow();
  const nufi = evmProvider({ flags: { isMetaMask: true } });
  const det = new Detector(win);
  announce(win, { uuid: 'n-1', name: 'NUFI', rdns: 'io.nu.fi' }, nufi);
  announce(win, { uuid: 'n-2', name: 'MetaMask', rdns: 'io.metamask' }, nufi);
  const list = (await det.detect({ waitMs: 5 })).filter((d) => d.family === 'evm');
  assert.equal(list.length, 2);
  for (const d of list) {
    assert.equal(d.objectId, list[0].objectId);
    assert.ok(d.warnings.some((w) => /also answers as/.test(w)), d.name);
  }
  const fake = list.find((d) => d.name === 'MetaMask');
  assert.equal(fake.productId, 'metamask', 'the report still points to the MetaMask row');
  assert.deepEqual(fake.sharedWith, ['NUFI']);
});

test('EIP-6963: a name and an rdns of different wallets is flagged', async () => {
  const win = fakeWindow();
  const det = new Detector(win);
  announce(win, { uuid: 'x', name: 'Phantom', rdns: 'io.metamask' }, evmProvider());
  const [d] = (await det.detect({ waitMs: 5 })).filter((e) => e.family === 'evm');
  assert.ok(d.warnings.some((w) => /rdns io\.metamask, which belongs to another wallet/.test(w)));
});

test('window.ethereum without an announcement is listed, and its multi-wallet flags are flagged', async () => {
  const eth = evmProvider({ flags: { isMetaMask: true, isPhantom: true } });
  const win = fakeWindow({ ethereum: eth });
  const det = new Detector(win);
  const [d] = (await det.detect({ waitMs: 5 })).filter((e) => e.family === 'evm');
  assert.equal(d.key, 'evm:window.ethereum');
  assert.equal(d.productId, null);
  assert.ok(d.warnings.some((w) => /claim several wallets/.test(w)));
});

test('window.ethereum that is also announced is not listed twice', async () => {
  const eth = evmProvider({ flags: { isMetaMask: true } });
  const win = fakeWindow({ ethereum: eth });
  const det = new Detector(win);
  announce(win, { uuid: 'm', name: 'MetaMask', rdns: 'io.metamask' }, eth);
  const list = (await det.detect({ waitMs: 5 })).filter((e) => e.family === 'evm');
  assert.equal(list.length, 1);
  assert.ok(list[0].notes.some((n) => /also window\.ethereum/.test(n)));
});

test('Wallet Standard: wallets that load before and after the page both register', async () => {
  const win = fakeWindow();
  const early = solWallet({ name: 'Phantom' });
  walletBefore(win, early);
  const det = new Detector(win);
  const late = solWallet({ name: 'Solflare', label: 'sol two' });
  walletAfter(win, late);
  walletAfter(win, { name: 'Not Solana', chains: ['bitcoin:mainnet'], features: {}, accounts: [] });
  const list = det.snapshot().filter((d) => d.family === 'solana');
  assert.deepEqual(list.map((d) => d.name).sort(), ['Phantom', 'Solflare']);
  const ph = list.find((d) => d.name === 'Phantom');
  assert.deepEqual(ph.supportedMessageVersions, [1]);
  assert.deepEqual(ph.formats, ['raw']);
  assert.equal(list.find((d) => d.name === 'Solflare').formats[0], 'offchain');
});

test('Wallet Standard: two wallets registering one name are both flagged; a shared key is noted', () => {
  const win = fakeWindow();
  const det = new Detector(win);
  walletAfter(win, solWallet({ name: 'Phantom' }));
  walletAfter(win, solWallet({ name: 'Phantom' }));
  const list = det.snapshot().filter((d) => d.family === 'solana');
  assert.equal(list.length, 2);
  for (const d of list) assert.ok(d.warnings.some((w) => /2 different wallets register the name "phantom"/.test(w)));
  for (const d of list) assert.ok(d.notes.some((n) => /also offered by Phantom/.test(n)));
  assert.equal(det.solanaKeysExcept(list[0]).length, 1);
});

test('CIP-30: entries under window.cardano; one object under two keys is flagged; a key and a name of different wallets too', () => {
  const eternl = cip30Wallet({ name: 'eternl' });
  const nufi = cip30Wallet({ name: 'NuFi', label: 'ada two' });
  const odd = cip30Wallet({ name: 'lace', label: 'ada three' });
  const win = fakeWindow({ cardano: { eternl: nufi, nufi, typhoncip30: odd, notAWallet: { name: 'x' }, real: eternl } });
  const det = new Detector(win);
  const list = det.snapshot().filter((d) => d.family === 'cardano');
  assert.deepEqual(list.map((d) => d.cip30Key).sort(), ['eternl', 'nufi', 'real', 'typhoncip30']);
  const fakeEternl = list.find((d) => d.cip30Key === 'eternl');
  assert.equal(fakeEternl.productId, 'eternl');
  assert.equal(fakeEternl.productBy, 'key');
  assert.ok(fakeEternl.warnings.some((w) => /also answers as/.test(w)));
  assert.ok(fakeEternl.warnings.some((w) => /names itself NuFi/.test(w)));
  assert.ok(list.find((d) => d.cip30Key === 'typhoncip30').warnings.some((w) => /names itself lace/.test(w)));
});

test('NEAR: injected objects before the selector, the selector\'s available modules after', () => {
  const sender = { isSender: true };
  const win = fakeWindow({ near: sender, nightly: { near: {} } });
  const injected = nearInjectedObjects(win);
  assert.deepEqual(injected.map((x) => x.moduleId), ['sender', 'nightly']);
  const before = nearDetected(null, injected);
  assert.deepEqual(before.map((d) => d.key), ['near:injected:sender', 'near:injected:nightly']);
  const modules = [
    { id: 'sender', type: 'injected', metadata: { name: 'Sender', available: true } },
    { id: 'okx-wallet', type: 'injected', metadata: { name: 'OKX Wallet', available: false } },
    { id: 'meteor-wallet', type: 'injected', metadata: { name: 'Meteor Wallet', available: true } },
    { id: 'my-near-wallet', type: 'browser', metadata: { name: 'MyNearWallet', available: true, deprecated: false } },
  ];
  const after = nearDetected(modules, injected);
  assert.deepEqual(after.map((d) => d.moduleId), ['sender', 'meteor-wallet', 'my-near-wallet']);
  assert.equal(after.find((d) => d.moduleId === 'sender').productId, 'sender');
  assert.ok(after.find((d) => d.moduleId === 'sender').notes.some((n) => /window\.near/.test(n)));
});

test('a hostile provider whose getters throw is listed without breaking detection', async () => {
  const win = fakeWindow();
  const det = new Detector(win);
  const hostile = new Proxy({ request: async () => [] }, { get: (t, k) => { if (k === 'request') return t.request; throw new Error('boom'); } });
  announce(win, { uuid: 'h', name: '<img src=x onerror=alert(1)>', rdns: 'evil' }, hostile);
  const [d] = (await det.detect({ waitMs: 5 })).filter((e) => e.family === 'evm');
  assert.equal(d.name, '<img src=x onerror=alert(1)>');
  assert.deepEqual(d.flags, []);
  assert.deepEqual(Object.keys(describeDetected(d)).includes('object'), false);
});
