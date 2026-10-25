// The view of one live result: the steps, the verdict beside the curated
// row, the visitor's readable answer and the export.

import { h, downloadText } from '../../app/dom.js';
import { CAPABILITY_ORDER } from '../../data/model.js';
import { exportResult, resultFileName, withReadable } from '../../probe/result.js';
import { valueBadge } from '../table/render.js';

const OUTCOME_TEXT = Object.freeze({ ok: 'connected', verified: 'verified', 'wrong-signature': 'does not verify', refused: 'refused', skipped: 'not asked' });

function stepsList(r) {
  return h('ol', { class: 'steps' }, r.steps.map((s) => h('li', { class: ['step', `o-${s.outcome}`], dataset: { step: s.id, outcome: s.outcome } },
    h('span', { class: 'slabel' }, s.label ?? s.id), ' ',
    h('span', { class: 'soutcome' }, OUTCOME_TEXT[s.outcome] ?? s.outcome),
    s.method ? h('span', { class: 'smethod' }, ` · ${s.method}`) : null,
    s.layout ? h('span', { class: 'smethod' }, ` · layout ${s.layout}`) : null,
    s.status ? h('span', { class: 'smethod' }, ` · status 0x${s.status}`) : null,
    s.reason ? h('div', { class: 'sreason' }, s.reason) : null,
    s.signer ? h('div', { class: 'sreason' }, `The signature verifies under ${s.signer}, another connected wallet's key.`) : null)));
}

function verdictTable(r, model) {
  const cmp = r.comparison;
  return h('table', { class: 'verdict' },
    h('caption', {}, cmp?.rowId ? `Your result beside the curated row "${cmp.label}" (the row of the name the wallet reports)` : 'Your result (no curated row carries this wallet\'s name)'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Capability'), h('th', { scope: 'col' }, 'Your result'), h('th', { scope: 'col' }, 'Curated row'), h('th', { scope: 'col' }, 'Comparison'))),
    h('tbody', {}, CAPABILITY_ORDER.map((cap) => {
      const c = r.cells[cap];
      const d = cmp?.perCapability?.[cap];
      const capLabel = model.capabilities.find((x) => x.id === cap)?.label ?? cap;
      const curated = cmp?.rowId ? model.views.get(cmp.rowId)?.cells.find((x) => x.capability === cap) : null;
      return h('tr', { dataset: { capability: cap, compare: d?.verdict ?? 'none' }, class: d?.verdict === 'differs' ? 'differs' : null },
        h('th', { scope: 'row' }, capLabel),
        h('td', {}, valueBadge(c.value, model.values.get(c.value)?.label ?? c.value), h('div', { class: 'reason' }, c.reason)),
        h('td', {}, curated ? [valueBadge(curated.value, model.values.get(curated.value)?.label ?? curated.value), h('div', { class: 'reason' }, curated.reason)] : '—'),
        h('td', { class: 'cmpcell' }, !d ? '—' : d.verdict === 'differs' ? h('strong', {}, 'differs') : d.verdict === 'same' ? 'same' : 'not compared (one side not yet measured)'));
    })));
}

/**
 * Renders a result. `onChange(result)` receives the result after the
 * visitor answers the readable question.
 */
export function resultView(r, model, { onChange, imported = false } = {}) {
  const baseline = r.comparison?.rowId ? model.views.get(r.comparison.rowId) : null;
  const radios = ['yes', 'partly', 'no', null].map((a) => h('label', { class: 'rbox' },
    h('input', { type: 'radio', name: `readable-${r.createdAt}`, value: a ?? 'unknown', checked: (r.readable ?? null) === a, disabled: imported, onchange: () => onChange?.(withReadable(r, a, baseline)) }),
    ` ${a === 'yes' ? 'Yes, readably' : a === 'partly' ? 'Only in part (cut, as hex, without line breaks)' : a === 'no' ? 'No (hashes, raw bytes or nothing)' : 'I cannot tell'}`));
  const differs = r.comparison?.differs ?? [];
  return h('div', { class: 'result', dataset: { family: r.family, differs: String(differs.length > 0) } },
    h('h3', {}, `${imported ? 'Imported result' : 'Your result'}: ${r.wallet?.reported?.name ?? r.wallet?.standard ?? 'wallet'} (${r.family.toUpperCase()})`),
    r.provisional ? h('p', { class: 'provisional' }, 'Provisional: this arm is not built yet; its probe texts follow the approved design and may change.') : null,
    r.testOnly ? h('p', { class: 'test-only' }, `Cardano: ${r.testOnly}.`) : null,
    r.identity ? h('p', { class: 'ident' }, `Signing identity: ${Object.values(r.identity).join(', ')}`) : null,
    differs.length ? h('p', { class: 'differs-note', role: 'status' }, `Your result differs from the curated row in: ${differs.map((c) => model.capabilities.find((x) => x.id === c)?.label ?? c).join(', ')}.`) : null,
    verdictTable(r, model),
    h('fieldset', { class: 'readable-q' }, h('legend', {}, 'Did the wallet show the text readably before you signed?'), radios),
    h('details', { class: 'steps-d' }, h('summary', {}, `Steps (${r.steps.length})`), stepsList(r)),
    h('p', { class: 'export-note' }, 'The exported file holds your wallet\'s public address or key and the probe signatures: they authorise nothing, but they identify your wallet. Nothing is uploaded; share the file only if you want to.'),
    h('button', { type: 'button', class: 'export-btn', onclick: () => downloadText(resultFileName(r), exportResult(r)) }, 'Export this result'));
}
