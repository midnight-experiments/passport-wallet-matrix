// The curated wallet table (user story 1): every curated row with its five
// cells, each with its value, reason and evidence; row states; legacy rows
// greyed; the via rows folded under their device; the visitor's detected
// wallets and live results on top of each family.

import { h, clear, append } from '../../app/dom.js';
import { modelCounts, STATE_ORDER, VALUE_ORDER } from '../../data/model.js';
import { tableHead, curatedRow, detectedRow, valueBadge } from './render.js';

function legend(model) {
  return h('div', { class: 'legend' },
    h('h3', {}, 'How to read a cell'),
    h('ul', { class: 'legend-values' }, VALUE_ORDER.map((v) => {
      const d = model.values.get(v);
      return h('li', {}, valueBadge(v, d.label), ' ', d.description);
    })),
    h('h3', {}, 'Row states'),
    h('ul', { class: 'legend-states' }, STATE_ORDER.map((s) => h('li', {}, h('span', { class: ['state', `s-${s}`] }, s), ' ', model.states.get(s)?.description ?? ''))),
    h('p', {}, 'Open a cell to read its reason and evidence. A row is one wallet, one connection path and one family. Hardware reached through a software wallet is folded under the device: open "Through software wallets".'));
}

function familyHeader(f) {
  return h('div', { class: 'family-head' },
    h('h2', { id: `family-${f.id}` }, f.label, ' ', h('span', { class: 'arm' }, `arm ${f.arm}, ${f.armStatus === 'built' ? 'built' : 'not built yet'}`)),
    f.testOnly ? h('p', { class: 'test-only', role: 'note' }, `The Cardano arm is ${f.testOnly}: it cannot bind a Cardano address to its key inside the circuit.`) : null,
    f.armStatus !== 'built' ? h('p', { class: 'provisional' }, 'This arm is not built yet: its format below is the approved design, and every "completes the operations on chain" cell waits for it.') : null,
    h('p', { class: 'format' }, h('strong', {}, 'Format: '), f.format),
    h('p', { class: 'discovery' }, h('strong', {}, 'Found through: '), f.discovery));
}

export default {
  id: 'table',
  title: 'Wallet table',
  order: 10,
  mount(el, ctx) {
    const { model, store } = ctx;
    const counts = modelCounts(model);
    const state = { family: model.families[0].id, query: '', states: new Set(STATE_ORDER), allVia: false, allOpen: false };

    const familyButtons = model.families.map((f) => h('button', { type: 'button', class: 'fam-btn', dataset: { family: f.id }, 'aria-pressed': 'false', onclick: () => { state.family = f.id; render(); } }, f.label));
    const search = h('input', { type: 'search', placeholder: 'Find a wallet', 'aria-label': 'Find a wallet', oninput: (e) => { state.query = e.target.value.trim().toLowerCase(); applyFilters(); } });
    const stateBoxes = STATE_ORDER.map((s) => h('label', { class: 'sbox' }, h('input', { type: 'checkbox', checked: true, dataset: { state: s }, onchange: (e) => { if (e.target.checked) state.states.add(s); else state.states.delete(s); applyFilters(); } }), ` ${s}`));
    const viaBox = h('label', { class: 'sbox' }, h('input', { type: 'checkbox', onchange: (e) => { state.allVia = e.target.checked; setAllVia(); } }), ' show hardware through software wallets');
    const openBox = h('label', { class: 'sbox' }, h('input', { type: 'checkbox', onchange: (e) => { state.allOpen = e.target.checked; setAllOpen(); } }), ' open every reason');
    const body = h('div', { class: 'family-view' });

    append(clear(el), 
      h('p', { class: 'summary' }, `${counts.products} products, ${counts.rows} rows (${counts.direct} direct, ${counts.via} through software wallets), ${counts.cells} cells: ${counts.byValue.check} checks, ${counts.byValue.warning} warnings, ${counts.byValue.cross} crosses, ${counts.byValue['not-yet-measured']} not yet measured.`),
      model.problems.length ? h('div', { class: 'error', role: 'alert' }, h('p', {}, `The curated data has ${model.problems.length} problem(s):`), h('ul', {}, model.problems.slice(0, 20).map((p) => h('li', {}, p)))) : null,
      legend(model),
      h('div', { class: 'controls' }, h('div', { class: 'fam-btns', role: 'group', 'aria-label': 'Family' }, familyButtons), search, h('div', { class: 'state-filter' }, stateBoxes, viaBox, openBox)),
      body,
    );

    const toggleVia = (device, button, force) => {
      const open = force ?? button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      for (const v of device.via) {
        const tr = body.querySelector(`tr[data-row="${CSS.escape(v.id)}"]`);
        if (tr) { tr.dataset.viaOpen = String(open); tr.hidden = !open || !visible(v); }
      }
    };
    const visible = (v) => state.states.has(v.state) && (!state.query || v.label.toLowerCase().includes(state.query));
    function applyFilters() {
      for (const tr of body.querySelectorAll('tr.crow')) {
        const v = model.views.get(tr.dataset.row);
        tr.hidden = v.path === 'via' ? !(tr.dataset.viaOpen === 'true' && visible(v)) : !visible(v);
      }
      for (const tr of body.querySelectorAll('tr.drow')) {
        const d = store.detected.get(tr.dataset.detected);
        tr.hidden = !!state.query && !String(d?.name ?? '').toLowerCase().includes(state.query);
      }
    }
    function setAllVia() {
      const f = model.families.find((x) => x.id === state.family);
      for (const device of f.hardware) {
        const b = body.querySelector(`button.via-toggle[data-device="${CSS.escape(device.id)}"]`);
        if (b) toggleVia(device, b, state.allVia);
      }
    }
    function setAllOpen() {
      for (const d of body.querySelectorAll('details.celld')) d.open = state.allOpen;
    }

    const onTest = (d) => { ctx.selectedWallet = d.key; ctx.go('test'); };
    let detectedBody = null;
    function renderDetected() {
      if (!detectedBody) return;
      clear(detectedBody);
      const list = [...store.detected.values()].filter((d) => d.family === state.family);
      for (const d of list) append(detectedBody, detectedRow(d, store.results.get(d.key), model, { onTest }));
      if (!list.length) append(detectedBody, h('tr', { class: 'none' }, h('td', { colspan: 6 }, 'No wallet of this family was detected in this browser.')));
    }

    function render() {
      for (const b of familyButtons) b.setAttribute('aria-pressed', String(b.dataset.family === state.family));
      const f = model.families.find((x) => x.id === state.family);
      detectedBody = h('tbody', { class: 'detected' });
      const table = h('table', { class: 'matrix', dataset: { family: f.id } },
        h('caption', {}, `${f.label}: ${f.software.length} software rows, ${f.hardware.length} hardware rows, ${f.hardware.reduce((n, d) => n + d.via.length, 0) + f.orphanVia.length} hardware rows through software wallets.`),
        tableHead(model),
        h('tbody', { class: 'group' }, h('tr', {}, h('th', { colspan: 6, scope: 'colgroup' }, 'Detected in this browser'))),
        detectedBody,
        h('tbody', { class: 'group' }, h('tr', {}, h('th', { colspan: 6, scope: 'colgroup' }, 'Software wallets'))),
        h('tbody', { class: 'software' }, f.software.map((v) => curatedRow(v, model))),
        h('tbody', { class: 'group' }, h('tr', {}, h('th', { colspan: 6, scope: 'colgroup' }, 'Hardware wallets'))),
        h('tbody', { class: 'hardware' }, f.hardware.flatMap((d) => [curatedRow(d, model, { onToggleVia: (dev, btn) => toggleVia(dev, btn) }), ...d.via.map((v) => curatedRow(v, model))]),
          f.orphanVia.map((v) => { const tr = curatedRow(v, model); tr.hidden = false; return tr; })),
      );
      append(clear(body), familyHeader(f), h('div', { class: 'table-wrap' }, table));
      renderDetected();
      applyFilters();
      if (state.allVia) setAllVia();
      if (state.allOpen) setAllOpen();
    }

    store.addEventListener('change', () => renderDetected());
    body.addEventListener('click', (ev) => {
      const a = ev.target.closest?.('a[data-jump]');
      if (!a) return;
      ev.preventDefault();
      const tr = body.querySelector(`tr[data-row="${CSS.escape(a.dataset.jump)}"]`);
      if (tr) { tr.hidden = false; tr.scrollIntoView({ block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1500); }
    });
    render();
  },
};
