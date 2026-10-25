// The direct hardware paths with stand-in devices: a Ledger transport that
// answers GET APP AND VERSION, Ledger app classes over software keys, and a
// Trezor Connect object over software keys. The emulator tests run the same
// code against Speculos and trezor-user-env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import data from '../../../data/wallets.json';
import { buildModel } from '../../src/data/model.js';
import { runHardwareTest } from '../../src/hw/run.js';
import { ledgerAppInfo } from '../../src/hw/ledger.js';
import { parseVersion, below, versionWarning } from '../../src/hw/versions.js';
import { typedDataDigest, personalMessageDigest } from '../../src/vendor.js';
import { toHex, fromHex, utf8, concat } from '../../src/bytes.js';
import { testSecp256k1, testSeed } from '../helpers/keys.mjs';
import { addressOf } from '../helpers/evm-wallet.mjs';

const model = buildModel(data);

function fakeTransport(appName, version) {
  return {
    deviceModel: { id: 'flex', productName: 'Ledger Flex' },
    async send(cla, ins) {
      if (cla === 0xb0 && ins === 0x01) {
        const n = utf8(appName), v = utf8(version);
        return concat(Uint8Array.of(1, n.length), n, Uint8Array.of(v.length), v, Uint8Array.of(1, 0), Uint8Array.of(0x90, 0));
      }
      throw new Error('unexpected APDU');
    },
  };
}

const evmSk = testSecp256k1('ledger evm');
const signDigest = (d) => { const r = secp256k1.sign(d, evmSk, { prehash: false, format: 'recovered' }); return { v: 27 + r[0], r: toHex(r.subarray(1, 33)), s: toHex(r.subarray(33)) }; };
class FakeEth {
  constructor(transport) { this.t = transport; }
  async getAddress() { return { address: '0x' + toHex(addressOf(evmSk)) }; }
  async signEIP712Message(_path, td) {
    if (this.t.blind !== true) throw Object.assign(new Error('Ledger device: UNKNOWN_ERROR (0x6a80)'), { statusCode: 0x6a80 });
    return signDigest(typedDataDigest(td));
  }
  async signPersonalMessage(_path, hex) { return signDigest(personalMessageDigest(fromHex(hex))); }
}
const solSeed = testSeed('ledger sol');
class FakeSolana {
  async getAppConfiguration() { return { version: this.version ?? '1.16.0' }; }
  async getAddress() { return { address: Buffer.from(ed25519.getPublicKey(solSeed)) }; }
  async signOffchainMessage(_path, msg) {
    if (msg[0] !== 0xff) throw Object.assign(new Error('0x6a81'), { statusCode: 0x6a81 });
    return { signature: Buffer.from(ed25519.sign(new Uint8Array(msg), solSeed)) };
  }
}

test('GET APP AND VERSION is read', async () => {
  assert.deepEqual(await ledgerAppInfo(fakeTransport('Solana', '1.16.0')), { name: 'Solana', version: '1.16.0' });
});

test('Ledger EVM with default settings: typed data refused with 0x6a80, personal_sign verified: a warning', async () => {
  const { detected, result } = await runHardwareTest({ vendor: 'ledger', family: 'evm', transport: fakeTransport('Ethereum', '1.22.5'), Eth: FakeEth, model });
  assert.equal(detected.key, 'hw:ledger:evm');
  assert.equal(result.wallet.hardware.app, 'Ethereum');
  assert.equal(result.wallet.hardware.appVersion, '1.22.5');
  assert.equal(result.wallet.hardware.model, 'Ledger Flex');
  const typed = result.steps.find((s) => s.id === 'typed#1');
  assert.equal(typed.outcome, 'refused');
  assert.equal(typed.status, '6a80');
  assert.equal(result.cells['signs-format'].value, 'warning');
  assert.match(result.cells['signs-format'].reason, /0x6a80/);
  assert.equal(result.comparison.rowId, 'ledger--evm');
  assert.equal(result.comparison.perCapability['signs-format'].verdict, 'same');
});

test('Ledger EVM with blind signing on: everything verifies', async () => {
  const t = fakeTransport('Ethereum', '1.22.5'); t.blind = true;
  const { result } = await runHardwareTest({ vendor: 'ledger', family: 'evm', transport: t, Eth: FakeEth, model });
  assert.equal(result.cells['signs-format'].value, 'check');
  assert.equal(result.cells.deterministic.value, 'check');
});

test('Ledger with the wrong app open: the test says which app to open', async () => {
  const { result } = await runHardwareTest({ vendor: 'ledger', family: 'evm', transport: fakeTransport('BOLOS', '1.7.0'), Eth: FakeEth, model });
  assert.equal(result.cells.connects.value, 'cross');
  assert.match(result.cells.connects.reason, /open the Ethereum app/);
  await assert.rejects(runHardwareTest({ vendor: 'ledger', family: 'solana', transport: fakeTransport('Ethereum', '1.22.5'), Solana: FakeSolana, model }), /open the Solana app/);
});

test('Ledger Solana 1.16.0: off-chain v1 verifies, no version warning', async () => {
  const { result } = await runHardwareTest({ vendor: 'ledger', family: 'solana', transport: fakeTransport('Solana', '1.16.0'), Solana: FakeSolana, model });
  assert.equal(result.steps.find((s) => s.id === 'probe:offchain').outcome, 'verified');
  assert.equal(result.cells['signs-format'].value, 'check');
  assert.equal(result.comparison.rowId, 'ledger--solana');
});

test('Ledger Solana below 1.16.0: a warning even though the signature verifies', async () => {
  class Old extends FakeSolana { constructor() { super(); this.version = '1.15.2'; } }
  const { result } = await runHardwareTest({ vendor: 'ledger', family: 'solana', transport: fakeTransport('Solana', '1.15.2'), Solana: Old, model });
  assert.equal(result.cells['signs-format'].value, 'warning');
  assert.match(result.cells['signs-format'].reason, /1\.15\.2 is older than 1\.16\.0/);
});

function fakeTrezor({ firmware = [2, 12, 5], fail = null } = {}) {
  const ok = (payload) => ({ success: true, payload });
  return {
    getFeatures: async () => ok({ major_version: firmware[0], minor_version: firmware[1], patch_version: firmware[2], internal_model: 'T3T1', model: 'Safe 5' }),
    ethereumGetAddress: async () => ok({ address: '0x' + toHex(addressOf(evmSk)) }),
    ethereumSignTypedData: async ({ data, metamask_v4_compat, domain_separator_hash, message_hash }) => {
      assert.equal(metamask_v4_compat, true);
      assert.equal(domain_separator_hash.length, 64);
      assert.equal(message_hash.length, 64);
      if (fail === 'typed') return { success: false, payload: { error: 'Cancelled', code: 'Failure_ActionCancelled' } };
      const s = signDigest(typedDataDigest(data));
      return ok({ address: '', signature: '0x' + s.r + s.s + s.v.toString(16) });
    },
    ethereumSignMessage: async ({ message, hex }) => { assert.equal(hex, true); const s = signDigest(personalMessageDigest(fromHex(message))); return ok({ address: '', signature: s.r + s.s + s.v.toString(16) }); },
    solanaGetPublicKey: async () => ok({ publicKey: toHex(ed25519.getPublicKey(solSeed)) }),
    solanaSignMessage: async ({ message }) => {
      // As the device does: the text, as UTF-8, after the v1 head.
      const pk = ed25519.getPublicKey(solSeed);
      const env = concat(Uint8Array.of(0xff), utf8('solana offchain'), Uint8Array.of(1, 1), pk, utf8(message));
      return ok({ signature: toHex(ed25519.sign(env, solSeed)), signedData: toHex(env) });
    },
  };
}

test('Trezor EVM: typed data with both hashes and v4 compatibility, personal_sign: check', async () => {
  const { result } = await runHardwareTest({ vendor: 'trezor', family: 'evm', TC: fakeTrezor(), model });
  assert.equal(result.cells['signs-format'].value, 'check');
  assert.equal(result.wallet.hardware.firmware, '2.12.5');
  assert.equal(result.comparison.rowId, 'trezor--evm');
});

test('Trezor: a Connect failure is a refusal with its code', async () => {
  const { result } = await runHardwareTest({ vendor: 'trezor', family: 'evm', TC: fakeTrezor({ fail: 'typed' }), model });
  const s = result.steps.find((x) => x.id === 'typed#1');
  assert.equal(s.outcome, 'refused');
  assert.match(s.reason, /Failure_ActionCancelled/);
});

test('Trezor Solana: the envelope Connect reports must be the client\'s; firmware below 2.12.4 warns', async () => {
  const { result } = await runHardwareTest({ vendor: 'trezor', family: 'solana', TC: fakeTrezor(), model });
  assert.equal(result.steps.find((s) => s.id === 'probe:offchain').outcome, 'verified');
  assert.equal(result.cells['signs-format'].value, 'check');
  const old = await runHardwareTest({ vendor: 'trezor', family: 'solana', TC: fakeTrezor({ firmware: [2, 12, 3] }), model });
  assert.equal(old.result.cells['signs-format'].value, 'warning');
  assert.match(old.result.cells['signs-format'].reason, /2\.12\.3 is older than 2\.12\.4/);
});

test('versions: parsing, comparison and the warnings', () => {
  assert.deepEqual(parseVersion('v2.12.5-arm'), [2, 12, 5]);
  assert.equal(parseVersion('two'), null);
  assert.equal(below('1.15.9', '1.16.0'), true);
  assert.equal(below('1.16.0', '1.16.0'), false);
  assert.equal(below('1.17.1', '1.16.0'), false);
  assert.equal(below('2.9.9', '2.12.4'), true);
  assert.equal(below('x', '1.0.0'), null);
  assert.equal(versionWarning({ vendor: 'ledger', family: 'solana', appVersion: '1.16.0' }), null);
  assert.match(versionWarning({ vendor: 'ledger', family: 'solana', appVersion: '1.15.0' }), /older than 1\.16\.0/);
  assert.match(versionWarning({ vendor: 'ledger', family: 'solana', appVersion: null }), /could not be read/);
  assert.equal(versionWarning({ vendor: 'trezor', family: 'solana', firmware: '2.12.4' }), null);
  assert.match(versionWarning({ vendor: 'trezor', family: 'solana', firmware: '2.12.3' }), /older than 2\.12\.4/);
  assert.match(versionWarning({ vendor: 'trezor', family: 'solana', firmware: null }), /could not be read/);
  assert.equal(versionWarning({ vendor: 'ledger', family: 'evm', appVersion: '1.0.0' }), null);
});
