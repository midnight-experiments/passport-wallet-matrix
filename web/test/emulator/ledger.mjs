// The page's direct Ledger path on Speculos (Flex, Speculos' public test
// mnemonic). Run once per app, in a container next to a Speculos container:
//
//   SPECULOS=http://<host>:5000 node ledger.mjs eth <out-dir>   (Ethereum app 1.22.5)
//   SPECULOS=http://<host>:5000 node ledger.mjs sol <out-dir>   (Solana app 1.16.0)
//
// eth: with default settings the app refuses the arm's V1 typed data
// (0x6a80), which the page shows as a warning, while personal_sign verifies
// and repeats; with blind signing switched on in the app, everything
// verifies. sol: the client's off-chain v1 envelope verifies and repeats;
// raw text is never sent. Each run writes its live results, the screens
// the driver acted on and its checks to <out-dir>.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import data from '../../../data/wallets.json';
import { buildModel } from '../../src/data/model.js';
import { runHardwareTest } from '../../src/hw/run.js';
import { exportResult, importResult } from '../../src/probe/result.js';
import { SpeculosApi, SpeculosTransport, withDriver, waitHome, enableBlindSigning } from './_speculos.mjs';

const require = createRequire(import.meta.url);
const [app = 'eth', OUT = '/tmp/ledger-out'] = process.argv.slice(2);
const BASE = process.env.SPECULOS ?? 'http://127.0.0.1:5000';
fs.mkdirSync(OUT, { recursive: true });
const model = buildModel(data);
const api = new SpeculosApi(BASE);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 160)})` : ''}`); };

// Ledger's libraries must make no network call: every fetch other than to
// Speculos is refused and recorded.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => { const s = String(u?.url ?? u); if (!s.startsWith(BASE)) { outbound.push(s); return Promise.reject(new Error(`network blocked: ${s}`)); } return realFetch(u, o); };

async function run(label, deps) {
  const transport = new SpeculosTransport(BASE);
  await waitHome(api);
  const { value, screens } = await withDriver(api, transport, () => runHardwareTest({ ...deps, transport, model }));
  const { result } = value;
  fs.writeFileSync(path.join(OUT, `${label}-result.json`), exportResult(result));
  fs.writeFileSync(path.join(OUT, `${label}-screens.json`), `${JSON.stringify({ screens, apdus: transport.apdus }, null, 1)}\n`);
  return { result, screens, apdus: transport.apdus };
}

const outcome = (r, id) => r.steps.find((s) => s.id === id)?.outcome;
if (app === 'eth') {
  const Eth = require('@ledgerhq/hw-app-eth').default;
  const a = await run('eth-default', { vendor: 'ledger', family: 'evm', Eth });
  check('eth: the app and its version are read', a.result.wallet.hardware.app === 'Ethereum' && a.result.wallet.hardware.appVersion === '1.22.5', JSON.stringify(a.result.wallet.hardware));
  const t1 = a.result.steps.find((s) => s.id === 'typed#1');
  check('eth default: the V1 typed data is refused with 0x6a80', t1.outcome === 'refused' && t1.status === '6a80', `${t1.outcome} ${t1.status} ${t1.reason}`);
  check('eth default: personal_sign verifies under the device address, twice the same', outcome(a.result, 'personal#1') === 'verified' && outcome(a.result, 'personal#2') === 'verified' && a.result.steps.find((s) => s.id === 'personal#2').sameAsFirst === true);
  check('eth default: the page shows a warning naming 0x6a80 and blind signing', a.result.cells['signs-format'].value === 'warning' && /0x6a80/.test(a.result.cells['signs-format'].reason) && /blind signing/.test(a.result.cells['signs-format'].reason), a.result.cells['signs-format'].reason);
  check('eth default: the same as the curated Ledger EVM row', a.result.comparison.rowId === 'ledger--evm' && a.result.comparison.perCapability['signs-format'].verdict === 'same' && a.result.comparison.perCapability.deterministic.verdict === 'same');
  const toggled = await enableBlindSigning(api);
  fs.writeFileSync(path.join(OUT, 'eth-blind-signing-toggle.json'), `${JSON.stringify(toggled, null, 1)}\n`);
  const b = await run('eth-blind-on', { vendor: 'ledger', family: 'evm', Eth });
  check('eth blind signing on: the V1 typed data verifies, twice the same', outcome(b.result, 'typed#1') === 'verified' && outcome(b.result, 'typed#2') === 'verified' && b.result.steps.find((s) => s.id === 'typed#2').sameAsFirst === true, JSON.stringify(b.result.steps.map((s) => [s.id, s.outcome, s.reason])));
  check('eth blind signing on: format and determinism are checks', b.result.cells['signs-format'].value === 'check' && b.result.cells.deterministic.value === 'check');
  check('eth blind signing on: the driver passed a warning screen before signing', b.screens.some((s) => /blind|risk|warning/i.test(s.text)), b.screens.map((s) => s.action).join(' | ').slice(0, 300));
  for (const [n, r] of [['default', a.result], ['blind-on', b.result]]) check(`eth ${n}: the exported result re-verifies on import`, JSON.stringify(importResult(exportResult(r)).cells) === JSON.stringify(r.cells));
} else {
  const Solana = require('@ledgerhq/hw-app-solana').default;
  const a = await run('sol', { vendor: 'ledger', family: 'solana', Solana });
  check('sol: the app and its version are read; no version warning at 1.16.0', a.result.wallet.hardware.app === 'Solana' && a.result.wallet.hardware.appVersion === '1.16.0' && !/older/.test(a.result.cells['signs-format'].reason), JSON.stringify(a.result.wallet.hardware));
  check('sol: the off-chain v1 probe verifies under the device key', outcome(a.result, 'probe:offchain') === 'verified', JSON.stringify(a.result.steps.map((s) => [s.id, s.outcome, s.reason])));
  check('sol: the privacy-key request verifies twice, the same', outcome(a.result, 'blind#1') === 'verified' && outcome(a.result, 'blind#2') === 'verified' && a.result.steps.find((s) => s.id === 'blind#2').sameAsFirst === true);
  check('sol: format and determinism are checks, as the curated row', a.result.cells['signs-format'].value === 'check' && a.result.cells.deterministic.value === 'check' && a.result.comparison.rowId === 'ledger--solana');
  const signs = a.apdus.filter((x) => x.ins === 0x07);
  check('sol: only off-chain message APDUs are signed (raw text never sent)', signs.length >= 3 && !a.result.steps.some((s) => s.format === 'raw'), `${signs.length} sign APDUs`);
  check('sol: the exported result re-verifies on import', JSON.stringify(importResult(exportResult(a.result)).cells) === JSON.stringify(a.result.cells));
}
check('no network call from Ledger\'s libraries', outbound.length === 0, outbound.join(' '));
fs.writeFileSync(path.join(OUT, `${app}-checks.json`), `${JSON.stringify({ app, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks }, null, 1)}\n`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
