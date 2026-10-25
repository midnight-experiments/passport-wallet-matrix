// Hardware, direct: a Ledger through WebHID with Ledger's own transport and
// app libraries, and a Trezor through Trezor Connect, each as its own row
// ("Ledger · direct", "Trezor · direct"). The page shows the app or firmware
// version and warns below the versions the Solana arm needs. The libraries
// load only when the visitor connects a device.

import { h, clear, append } from '../../app/dom.js';
import { TREZOR_MANIFEST } from '../../config.js';
import { versionWarning } from '../../hw/versions.js';
import { runHardwareTest } from '../../hw/run.js';
import { describeError } from '../../probe/common.js';
import { resultView } from '../test/result-view.js';

let trezorReady = null;
async function trezorConnect() {
  trezorReady ??= (async () => {
    const mod = await import('@trezor/connect-web');
    const TC = mod.default ?? mod.TrezorConnect;
    await TC.init({ manifest: TREZOR_MANIFEST, lazyLoad: true });
    return TC;
  })().catch((e) => { trezorReady = null; throw e; });
  return trezorReady;
}

async function ledgerTransport() {
  if (!globalThis.navigator?.hid) {
    throw new Error('this browser has no WebHID: use a desktop Chrome, Edge, Opera or Brave (Firefox and Safari do not offer it)');
  }
  const mod = await import('@ledgerhq/hw-transport-webhid');
  return (mod.default ?? mod).create();
}

export default {
  id: 'hardware',
  title: 'Hardware, direct',
  order: 40,
  mount(el, ctx) {
    const { model, store } = ctx;
    const out = h('div', { class: 'hw-out', 'aria-live': 'polite' });
    const buttons = [];
    const runOne = async (vendor, family) => {
      for (const b of buttons) b.disabled = true;
      append(clear(out), h('p', { class: 'running' }, `Connecting the ${vendor === 'ledger' ? 'Ledger' : 'Trezor'}: confirm each request on the device.`));
      let transport;
      try {
        let deps = { vendor, family, model };
        if (vendor === 'ledger') {
          transport = await ledgerTransport();
          if (family === 'evm') deps.Eth = (await import('@ledgerhq/hw-app-eth')).default;
          else deps.Solana = (await import('@ledgerhq/hw-app-solana')).default;
          deps.transport = transport;
        } else {
          deps.TC = await trezorConnect();
        }
        const { detected, result } = await runHardwareTest(deps);
        store.addDetected(detected);
        const show = (r) => {
          store.setResult(detected.key, r);
          const hw = r.wallet.hardware ?? {};
          const warn = versionWarning(hw);
          append(clear(out), 
            h('p', { class: 'hwinfo' }, vendor === 'ledger' ? `App ${hw.app ?? '?'} ${hw.appVersion ?? ''}${hw.model ? ` on ${hw.model}` : ''}` : `Firmware ${hw.firmware ?? '?'}${hw.model ? ` on ${hw.model}` : ''}`),
            warn ? h('p', { class: 'warning', role: 'alert' }, warn) : null,
            resultView(r, model, { onChange: show }));
        };
        show(result);
      } catch (e) {
        append(clear(out), h('p', { class: 'error', role: 'alert' }, `The device test stopped: ${describeError(e)}`));
      } finally {
        try { await transport?.close?.(); } catch { /* already closed */ }
        for (const b of buttons) b.disabled = false;
      }
    };
    const btn = (label, vendor, family) => { const b = h('button', { type: 'button', class: 'hw-btn', dataset: { vendor, family }, onclick: () => runOne(vendor, family) }, label); buttons.push(b); return b; };
    append(clear(el), 
      h('p', {}, 'Connect a device directly. The page asks it for the same probes as a software wallet and verifies every signature itself. Ledger needs a browser with WebHID; Trezor opens Trezor\'s own Connect window.'),
      h('div', { class: 'hw-group' },
        h('h3', {}, 'Ledger'),
        h('p', {}, 'Open the app on the device first. The Ethereum app refuses the arm\'s typed data (0x6a80) unless blind signing is on in its settings; the Solana app needs version 1.16.0 or later.'),
        btn('Ledger: Ethereum app', 'ledger', 'evm'), ' ', btn('Ledger: Solana app', 'ledger', 'solana')),
      h('div', { class: 'hw-group' },
        h('h3', {}, 'Trezor'),
        h('p', {}, 'Solana needs firmware 2.12.4 or later; the Model One has no Solana support.'),
        btn('Trezor: EVM', 'trezor', 'evm'), ' ', btn('Trezor: Solana', 'trezor', 'solana')),
      out);
  },
};
