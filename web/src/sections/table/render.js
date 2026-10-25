// Rendering of the wallet table: one table per family; software rows, then
// devices with their "via" rows folded under them; every cell with its value,
// reason and evidence; the visitor's detected wallets on top, with their live
// results beside the curated row of the name they report.

import { h, extLink } from '../../app/dom.js';
import { popularityText, CAPABILITY_ORDER } from '../../data/model.js';

export const ICONS = Object.freeze({ check: '✓', warning: '!', cross: '✕', 'not-yet-measured': '–', untested: '?' });
const EVIDENCE_KIND = Object.freeze({ 'workspace-test': 'workspace test', 'emulator-vector': 'emulator run', 'primary-source': 'primary source', research: 'research', missing: 'missing' });
const STATE_TEXT = Object.freeze({ tested: 'tested', documented: 'documented', unconfirmed: 'unconfirmed', limited: 'limited', legacy: 'legacy: never recommended' });

export function valueBadge(value, label) {
  return h('span', { class: ['vbadge', `v-${value}`] }, h('span', { class: 'icon', 'aria-hidden': 'true' }, ICONS[value] ?? '?'), h('span', { class: 'vlabel' }, label));
}

function surfaceLines(surface) {
  if (!surface) return null;
  const parts = Object.entries(surface).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? h('p', { class: 'surface' }, parts.join('; ')) : null;
}

export function evidenceItem(e) {
  return h('li', { class: ['evidence-item', `k-${e.kind}`], dataset: { evidence: e.id } },
    h('span', { class: 'ekind' }, EVIDENCE_KIND[e.kind] ?? e.kind), ' ',
    e.url ? extLink(e.url, e.title) : h('span', { class: 'etitle' }, e.title),
    e.date ? h('span', { class: 'edate' }, ` (${e.date})`) : null,
    h('details', { class: 'edetail' }, h('summary', {}, 'What it shows'), h('p', {}, e.description), surfaceLines(e.surface)));
}

/** One curated cell: the value as a disclosure, its reason and evidence. */
export function curatedCell(c, model) {
  const def = model.values.get(c.value);
  const cap = model.capabilities.find((x) => x.id === c.capability);
  return h('td', { class: ['cell', `v-${c.value}`], dataset: { capability: c.capability, value: c.value } },
    h('details', { class: 'celld' },
      h('summary', { 'aria-label': `${cap?.label ?? c.capability}: ${def?.label ?? c.value}` }, valueBadge(c.value, def?.label ?? c.value)),
      h('p', { class: 'reason' }, c.reason),
      h('ul', { class: 'evidence' }, c.evidence.map(evidenceItem))));
}

function badges(v) {
  return h('span', { class: 'badges' },
    h('span', { class: ['state', `s-${v.state}`], title: v.state }, STATE_TEXT[v.state] ?? v.state),
    v.path === 'via' ? h('span', { class: 'kind' }, 'through a software wallet') : null,
    ...v.kind.map((k) => h('span', { class: 'kind' }, k)));
}

function rowHeader(v, model, extra) {
  const product = v.product;
  const lifecycle = product?.lifecycle;
  return h('th', { scope: 'row', class: 'wallet' },
    h('div', { class: 'wname' }, v.label),
    badges(v),
    v.path !== 'via' && product?.popularity ? h('div', { class: 'pop' }, 'Popularity: ', product.popularity.source ? extLink(product.popularity.source, popularityText(product)) : popularityText(product)) : null,
    lifecycle && lifecycle.status !== 'active' ? h('div', { class: 'lifecycle' }, `${lifecycle.status}${lifecycle.note ? `: ${lifecycle.note}` : ''}`) : null,
    v.notes.length || product?.notes?.length ? h('details', { class: 'notes' }, h('summary', {}, 'Notes'), h('ul', {}, [...(product?.notes ?? []), ...v.notes].map((n) => h('li', {}, n)))) : null,
    extra ?? null);
}

/** A curated row. A device's row carries the toggle of its via rows. */
export function curatedRow(v, model, { onToggleVia } = {}) {
  let extra = null;
  if (v.via.length) {
    extra = h('button', { type: 'button', class: 'via-toggle', 'aria-expanded': 'false', dataset: { device: v.id }, onclick: (ev) => onToggleVia?.(v, ev.currentTarget) },
      `Through software wallets (${v.via.length})`);
  } else if (v.devicesThrough.length) {
    extra = h('div', { class: 'through' }, `Hardware through ${v.product?.name ?? v.label}: `, v.devicesThrough.map((d) => d.product?.name ?? d.row.product).join(', '), '.');
  }
  return h('tr', { class: ['crow', v.legacy && 'legacy', v.path === 'via' && 'via'], id: `row-${v.id}`, dataset: { row: v.id, state: v.state, path: v.path, product: v.row.product }, hidden: v.path === 'via' ? true : null },
    rowHeader(v, model, extra),
    v.cells.map((c) => curatedCell(c, model)));
}

/** A live cell: the visitor's own result, or "untested". */
export function liveCell(cap, live, cmp, model) {
  if (!live) {
    return h('td', { class: ['cell', 'v-untested'], dataset: { capability: cap, value: 'untested' } },
      valueBadge('untested', 'Untested'));
  }
  const c = live[cap];
  const def = model.values.get(c.value);
  const d = cmp?.perCapability?.[cap];
  return h('td', { class: ['cell', `v-${c.value}`, d?.verdict === 'differs' && 'differs'], dataset: { capability: cap, value: c.value, compare: d?.verdict ?? 'none' } },
    h('details', { class: 'celld' },
      h('summary', {}, valueBadge(c.value, def?.label ?? c.value), d?.verdict === 'differs' ? h('span', { class: 'difftag' }, ' differs') : null),
      h('p', { class: 'reason' }, c.reason),
      h('p', { class: 'own' }, 'Your own result, from this browser; not reviewed.'),
      d && d.verdict !== 'not-compared' ? h('p', { class: 'cmp' }, d.verdict === 'same' ? `Same as the curated row (${model.values.get(d.baseline)?.label}).` : `Differs from the curated row, which says ${model.values.get(d.baseline)?.label}.`) : null));
}

/** A detected wallet's row: what it reports, how the page identifies it,
 *  and its live result if the visitor tested it. */
export function detectedRow(d, result, model, { onTest } = {}) {
  const match = d.productId ? model.views.get(`${d.productId}--${d.family}`) : null;
  const cmp = result?.comparison;
  return h('tr', { class: ['drow', result ? 'tested' : 'untested'], dataset: { detected: d.key } },
    h('th', { scope: 'row', class: 'wallet' },
      h('div', { class: 'wname' }, d.name ?? d.key, h('span', { class: 'reported' }, ' (reported by the wallet)')),
      h('span', { class: 'badges' }, h('span', { class: 'state s-detected' }, result ? 'your result' : 'untested'), h('span', { class: 'kind' }, d.standard)),
      h('div', { class: 'ident' }, `Provider object ${d.objectId ?? 'unknown'}`, d.rdns ? `, rdns ${d.rdns}` : '', d.cip30Key ? `, window.cardano.${d.cip30Key}` : ''),
      d.warnings.length ? h('ul', { class: 'warnings', role: 'note' }, d.warnings.map((w) => h('li', {}, w))) : null,
      match ? h('div', { class: 'match' }, 'Its name points to the curated row ', h('a', { href: `#/table`, dataset: { jump: match.id } }, match.label), cmp?.differs?.length ? h('strong', { class: 'differs-note' }, `: the live result differs in ${cmp.differs.map((c) => model.capabilities.find((x) => x.id === c)?.label ?? c).join(', ')}.`) : '.') : h('div', { class: 'match' }, 'No curated row carries its name.'),
      onTest ? h('button', { type: 'button', class: 'test-btn', onclick: () => onTest(d) }, result ? 'Test again' : 'Test this wallet') : null),
    CAPABILITY_ORDER.map((cap) => liveCell(cap, result?.cells, cmp, model)));
}

/** The table head: the wallet column and the five capabilities. */
export function tableHead(model) {
  return h('thead', {}, h('tr', {},
    h('th', { scope: 'col', class: 'wallet' }, 'Wallet and path'),
    model.capabilities.map((c) => h('th', { scope: 'col', title: c.description }, c.label))));
}
