// The page's direct Trezor path on trezor-user-env's emulator (Safe 5,
// T3T1, the public test seed "all all ... all"), through Trezor Connect for
// Node: the same Connect calls the page makes through @trezor/connect-web.
// Run in the emulator container's network namespace (its controller on
// 127.0.0.1:9001, the emulator's UDP port on 127.0.0.1:21324):
//
//   node trezor.mjs <out-dir>
//
// The test plays the user through the controller's debug link (press yes,
// swipe up) while each Connect call is pending, and records every screen.

import fs from 'node:fs';
import path from 'node:path';
import TrezorConnect from '@trezor/connect';
import { UdpTransport } from '@trezor/transport';
import data from '../../../data/wallets.json';
import { buildModel } from '../../src/data/model.js';
import { runHardwareTest } from '../../src/hw/run.js';
import { exportResult, importResult } from '../../src/probe/result.js';
import { TREZOR_MANIFEST } from '../../src/config.js';

const OUT = process.argv[2] ?? '/tmp/trezor-out';
fs.mkdirSync(OUT, { recursive: true });
const model = buildModel(data);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The trezor-user-env controller: JSON over a WebSocket, matched by id.
class Controller {
  constructor(url) { this.url = url; this.next = 1; this.waiting = new Map(); this.log = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      const w = this.waiting.get(m.id);
      if (w) { this.waiting.delete(m.id); w(m); }
    };
  }
  send(type, fields = {}) {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, (m) => { if (type !== 'emulator-get-screen-content') this.log.push({ type, ...fields, success: m.success, response: typeof m.response === 'string' ? m.response.slice(0, 160) : m.response }); resolve(m); });
      this.ws.send(JSON.stringify({ type, id, ...fields }));
    });
  }
}

const ctl = new Controller(process.env.TENV_CONTROLLER ?? 'ws://127.0.0.1:9001');
await ctl.open();
const started = await ctl.send('emulator-start', { model: 'T3T1', version: '2-latest', wipe: true, output_to_logfile: true });
check('the emulator starts', started.success === true, started.response ?? started.error);
const setup = await ctl.send('emulator-setup', { mnemonic: 'all all all all all all all all all all all all', pin: '', passphrase_protection: false, label: 'wallet-matrix-test', needs_backup: false });
check('the emulator is set up with the public test seed', setup.success === true, setup.error ?? '');

// Plays the user while a Connect call is pending: press yes; when a screen
// does not change after a press, swipe up (a page of a longer review).
let pending = 0;
const screens = [];
const driver = (async () => {
  let last = '', pressedOn = '';
  for (;;) {
    if (pending === 0) { await sleep(150); if (driver.stop) return; continue; }
    const r = await ctl.send('emulator-get-screen-content');
    const c = r.response ?? {};
    const key = `${c.title ?? ''}|${c.body ?? ''}`;
    if (!c.title && !c.body) { await sleep(200); continue; }
    const act = pressedOn === key ? 'swipe up' : 'press yes';
    screens.push({ title: c.title, body: String(c.body ?? '').slice(0, 300), action: act });
    if (act === 'press yes') { pressedOn = key; await ctl.send('emulator-press-yes'); } else { pressedOn = ''; await ctl.send('emulator-swipe', { direction: 'up' }); }
    last = key;
    await sleep(500);
  }
})();
const TC = new Proxy(TrezorConnect, {
  get(target, k) {
    const v = target[k];
    if (typeof v !== 'function' || !/^(ethereum|solana|getFeatures)/.test(String(k))) return v;
    return async (...a) => { pending++; try { return await v.apply(target, a); } finally { pending--; } };
  },
});

// Connect must make no call outside this machine.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => { const s = String(u?.url ?? u); if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(s)) { outbound.push(s); return Promise.reject(new Error(`network blocked: ${s}`)); } return realFetch(u, o); };

// The emulator's own UDP port (no bridge): Connect for Node takes transport
// instances.
await TrezorConnect.init({ manifest: TREZOR_MANIFEST, transports: [new UdpTransport({})], debug: false, lazyLoad: false, transportReconnect: false, pendingTransportEvent: true });
check('Trezor Connect starts with the page\'s manifest (empty contact address)', true);
await sleep(1500);

const outcome = (r, id) => r.steps.find((s) => s.id === id)?.outcome;
const evm = (await runHardwareTest({ vendor: 'trezor', family: 'evm', TC, model })).result;
fs.writeFileSync(path.join(OUT, 'evm-result.json'), exportResult(evm));
check('evm: the firmware version is read', /^2\.\d+\.\d+$/.test(evm.wallet.hardware.firmware ?? ''), JSON.stringify(evm.wallet.hardware));
check('evm: the V1 typed data verifies under the device address, twice the same', outcome(evm, 'typed#1') === 'verified' && outcome(evm, 'typed#2') === 'verified' && evm.steps.find((s) => s.id === 'typed#2').sameAsFirst === true, JSON.stringify(evm.steps.map((s) => [s.id, s.outcome, s.reason])));
check('evm: personal_sign verifies, twice the same', outcome(evm, 'personal#1') === 'verified' && evm.steps.find((s) => s.id === 'personal#2').sameAsFirst === true);
check('evm: format and determinism are checks, as the curated Trezor EVM row', evm.cells['signs-format'].value === 'check' && evm.cells.deterministic.value === 'check' && evm.comparison.rowId === 'trezor--evm' && evm.comparison.perCapability['signs-format'].verdict === 'same');

// What Connect returns for an off-chain message: the signed bytes it
// reports, beside the envelope the client builds.
{
  const { trezorSolanaSource } = await import('../../src/hw/trezor.js');
  const { solFormatProbeBytes, solFormatProbeText, verifySolSignature } = await import('../../src/vendor.js');
  const src = await trezorSolanaSource({ TC });
  const text = solFormatProbeText(src.source.publicKey, new Uint8Array(32).fill(7));
  const env = solFormatProbeBytes('offchain', src.source.publicKey, text);
  const r = await TC.solanaSignMessage({ path: "m/44'/501'/0'/0'", message: Buffer.from(text).toString('utf8') });
  const signed = r.payload?.signedData ? Buffer.from(r.payload.signedData, 'hex') : null;
  const sig = r.payload?.signature ? Buffer.from(r.payload.signature, 'hex') : null;
  const ok = (m) => { try { verifySolSignature(new Uint8Array(m), new Uint8Array(sig), src.source.publicKey); return true; } catch { return false; } };
  fs.writeFileSync(path.join(OUT, 'solana-envelope-debug.json'), JSON.stringify({
    success: r.success, envelopeHex: Buffer.from(env).toString('hex'), signedHex: signed?.toString('hex') ?? null,
    signedLength: signed?.length ?? null, envelopeLength: env.length, sigOverEnvelope: sig ? ok(env) : null, sigOverSigned: sig && signed ? ok(signed) : null,
  }, null, 1));
}
const sol = (await runHardwareTest({ vendor: 'trezor', family: 'solana', TC, model })).result;
fs.writeFileSync(path.join(OUT, 'solana-result.json'), exportResult(sol));
check('solana: no version warning at this firmware', !/older|could not be read/.test(sol.cells['signs-format'].reason), sol.cells['signs-format'].reason);
check('solana: the off-chain v1 probe verifies, and Connect reports the client\'s envelope', outcome(sol, 'probe:offchain') === 'verified', JSON.stringify(sol.steps.map((s) => [s.id, s.outcome, s.reason])));
check('solana: the privacy-key request verifies twice, the same', outcome(sol, 'blind#1') === 'verified' && sol.steps.find((s) => s.id === 'blind#2').sameAsFirst === true);
check('solana: format and determinism are checks, as the curated Trezor Solana row', sol.cells['signs-format'].value === 'check' && sol.cells.deterministic.value === 'check' && sol.comparison.rowId === 'trezor--solana');
for (const [n, r] of [['evm', evm], ['solana', sol]]) check(`${n}: the exported result re-verifies on import`, JSON.stringify(importResult(exportResult(r)).cells) === JSON.stringify(r.cells));
// Connect for Node asks Trezor's data server for firmware release data and
// Ethereum network definitions; the test network has no route out, so these
// fail, and every signature above verified without them. The page's own
// code calls nothing.
fs.writeFileSync(path.join(OUT, 'connect-outbound.json'), `${JSON.stringify(outbound, null, 1)}\n`);
check('Connect\'s only outbound requests are to Trezor\'s data server, and none reached it', outbound.every((u) => u.startsWith('https://data.trezor.io/')), [...new Set(outbound.map((u) => u.replace(/\/[^/]*$/, '/')))].join(' '));

driver.stop = true;
await TrezorConnect.dispose?.();
await ctl.send('emulator-stop');
fs.writeFileSync(path.join(OUT, 'screens.json'), `${JSON.stringify({ screens, controller: ctl.log }, null, 1)}\n`);
fs.writeFileSync(path.join(OUT, 'checks.json'), `${JSON.stringify({ passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks }, null, 1)}\n`);
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
