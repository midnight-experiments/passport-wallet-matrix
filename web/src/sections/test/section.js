// "Test my wallet": pick a detected wallet, see what it will be asked, run
// the family's test, answer whether the text was readable, export the
// result. An exported file can be loaded back: it is verified again, and the
// verdict is computed again from its signatures.

import { h, clear, append } from '../../app/dom.js';
import { runDetectedTest, PROMPTS, baselineFor } from '../../probe/run.js';
import { importResult } from '../../probe/result.js';
import { describeError } from '../../probe/common.js';
import { resultView } from './result-view.js';

export default {
  id: 'test',
  title: 'Test my wallet',
  order: 30,
  mount(el, ctx) {
    const { model, store } = ctx;
    const select = h('select', { 'aria-label': 'Wallet to test', class: 'wallet-select' });
    const version = h('input', { type: 'text', placeholder: 'optional: the wallet\'s version, as it shows it', 'aria-label': 'Wallet version', class: 'version-input' });
    const prompts = h('div', { class: 'prompts' });
    const out = h('div', { class: 'test-out', 'aria-live': 'polite' });
    const run = h('button', { type: 'button', class: 'run-btn' }, 'Run the test');
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Load an exported result' });
    const importOut = h('div', { class: 'import-out', 'aria-live': 'polite' });

    const fill = () => {
      const keep = ctx.selectedWallet ?? select.value;
      clear(select);
      const list = [...store.detected.values()].filter((d) => d.family !== 'near' || d.standard === 'NEAR wallet selector');
      if (!list.length) append(select, h('option', { value: '' }, 'No wallet detected yet (see "Detected wallets")'));
      for (const d of list) append(select, h('option', { value: d.key, selected: d.key === keep }, `${d.family.toUpperCase()} · ${d.name ?? d.key} (reported) · ${d.standard}`));
      showPrompts();
    };
    const showPrompts = () => {
      const d = store.detected.get(select.value);
      clear(prompts);
      if (!d) return;
      append(prompts, 
        h('p', {}, `The wallet will be asked, in its own window:`),
        h('ol', {}, PROMPTS[d.family].map((p) => h('li', {}, p))),
        d.family === 'near' || d.family === 'cardano' ? h('p', { class: 'provisional' }, 'Provisional: this arm is not built yet; the texts follow its approved design.') : null,
        d.family === 'cardano' ? h('p', { class: 'test-only' }, 'The Cardano arm is test only: address not bound.') : null,
        d.warnings.length ? h('ul', { class: 'warnings' }, d.warnings.map((w) => h('li', {}, w))) : null);
    };
    select.addEventListener('change', () => { ctx.selectedWallet = select.value; showPrompts(); });
    store.addEventListener('change', (ev) => { if (ev.detail?.what === 'detected') fill(); });

    const show = (r) => {
      store.setResult(r.wallet?.reported?.key ?? r.wallet?.key, r);
      append(clear(out), resultView(r, model, { onChange: show }));
    };
    run.addEventListener('click', async () => {
      const d = store.detected.get(select.value);
      if (!d) return;
      run.disabled = true;
      append(clear(out), h('p', { class: 'running' }, `Testing ${d.name ?? d.key}: answer each request in the wallet's own window.`));
      try {
        show(await runDetectedTest(d, ctx, { version: version.value.trim() || null }));
      } catch (e) {
        append(clear(out), h('p', { class: 'error', role: 'alert' }, `The test stopped: ${describeError(e)}`));
      } finally {
        run.disabled = false;
      }
    });
    importInput.addEventListener('change', async () => {
      const f = importInput.files?.[0];
      if (!f) return;
      clear(importOut);
      try {
        const text = await f.text();
        const peek = JSON.parse(text);
        const baseline = peek?.comparison?.rowId ? model.views.get(peek.comparison.rowId) ?? null : baselineFor(model, peek?.wallet?.reported);
        const r = importResult(text, baseline);
        append(importOut, h('p', { class: 'ok', role: 'status' }, 'The file checks out: every signature verifies again and the verdict follows from them.'), resultView(r, model, { imported: true }));
      } catch (e) {
        append(importOut, h('p', { class: 'error', role: 'alert' }, `The file was not accepted: ${e.message}`));
      }
    });

    append(clear(el), 
      h('p', {}, 'Run the checks on a wallet installed in this browser: it signs probe texts in the arm\'s formats, the page verifies every signature itself, signs each request twice to see whether it repeats, and shows your result beside the curated row. Nothing is sent to a server, and nothing signed here authorises anything.'),
      h('div', { class: 'test-controls' }, select, version, run),
      prompts,
      out,
      h('h3', {}, 'Load an exported result'),
      h('p', {}, 'A result file is checked again here: its signatures, and the verdict they lead to.'),
      importInput,
      importOut);
    fill();
  },
  onShow() {},
};
