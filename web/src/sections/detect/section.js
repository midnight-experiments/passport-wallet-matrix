// Detected wallets: every wallet this browser exposes through EIP-6963 (and
// window.ethereum), the Wallet Standard, the NEAR wallet selector and CIP-30,
// with the provider object the page would use. Names are the wallets' own
// reports and are shown as such.

import { h, clear, append } from '../../app/dom.js';
import { loadNearSelector, selectorModules } from '../../detect/near.js';
import { describeError } from '../../probe/common.js';

const FAMILY_LABEL = { evm: 'EVM', solana: 'Solana', near: 'NEAR', cardano: 'Cardano' };

function entryView(d, model, onTest) {
  const match = d.productId ? model.views.get(`${d.productId}--${d.family}`) : null;
  return h('li', { class: 'detected-entry', dataset: { detected: d.key } },
    h('div', { class: 'dname' }, h('strong', {}, d.name ?? d.key), ' ', h('span', { class: 'reported' }, '(reported by the wallet)')),
    h('div', { class: 'dmeta' }, `${d.standard} · provider object ${d.objectId ?? 'unknown'}`,
      d.rdns ? ` · rdns ${d.rdns}` : '', d.cip30Key ? ` · window.cardano.${d.cip30Key}` : '', d.apiVersion ? ` · CIP-30 API ${d.apiVersion}` : '',
      d.version ? ` · version ${d.version}` : '', d.flags?.length ? ` · flags ${d.flags.join(', ')}` : ''),
    d.family === 'solana' ? h('div', { class: 'dmeta' },
      `supportedMessageVersions: ${d.supportedMessageVersions ? `[${d.supportedMessageVersions.join(', ')}]` : 'not advertised'}`,
      ` · formats the client would ask: ${d.formats?.length ? d.formats.join(', ') : 'none'}`) : null,
    d.warnings.length ? h('ul', { class: 'warnings', role: 'note' }, d.warnings.map((w) => h('li', {}, w))) : null,
    d.notes.length ? h('ul', { class: 'dnotes' }, d.notes.map((w) => h('li', {}, w))) : null,
    h('div', { class: 'dmatch' }, match ? `Its name points to the curated row "${match.label}"; its own result is shown as its own, never as that row's.` : 'No curated row carries its name: it is shown as untested until you test it.'),
    d.family === 'near' && d.standard !== 'NEAR wallet selector' ? null : h('button', { type: 'button', class: 'test-btn', onclick: () => onTest(d) }, 'Test this wallet'));
}

export default {
  id: 'detect',
  title: 'Detected wallets',
  order: 20,
  mount(el, ctx) {
    const { model, store, detector } = ctx;
    const list = h('div', { class: 'detected-list' });
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const onTest = (d) => { ctx.selectedWallet = d.key; ctx.go('test'); };
    const render = () => {
      clear(list);
      const all = [...store.detected.values()];
      for (const fam of ['evm', 'solana', 'near', 'cardano']) {
        const items = all.filter((d) => d.family === fam);
        append(list, h('h3', {}, `${FAMILY_LABEL[fam]} (${items.length})`),
          items.length ? h('ul', { class: 'detected-ul' }, items.map((d) => entryView(d, model, onTest))) : h('p', { class: 'none' }, 'None detected.'));
      }
    };
    const again = h('button', { type: 'button', onclick: async () => { status.textContent = 'Asking wallets to announce themselves…'; store.setDetected(await detector.detect()); status.textContent = `${store.detected.size} wallet entries.`; } }, 'Detect again');
    const near = h('button', { type: 'button', onclick: async () => {
      status.textContent = 'Loading the NEAR wallet selector…';
      try {
        const selector = await loadNearSelector();
        detector.nearModules = selectorModules(selector);
        for (const k of [...store.detected.keys()]) if (k.startsWith('near:')) store.detected.delete(k);
        store.setDetected(detector.snapshot());
        status.textContent = `The NEAR wallet selector lists ${detector.nearModules.length} modules.`;
      } catch (e) {
        status.textContent = `The NEAR wallet selector could not be loaded: ${describeError(e)}`;
      }
    } }, 'Load the NEAR wallet selector');
    store.addEventListener('change', (ev) => { if (ev.detail?.what === 'detected') render(); });
    append(clear(el), 
      h('p', {}, 'Wallets announce themselves to every page. The page lists what this browser announces, and identifies each wallet by the object it hands over: a wallet can claim any name, so a name is only what the wallet reports. Detection asks no wallet for an account.'),
      h('div', { class: 'detect-controls' }, again, near),
      status,
      list);
    render();
  },
};
