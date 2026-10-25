import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../../../data/wallets.json';
import { buildModel, modelCounts, rowLabel, CAPABILITY_ORDER } from '../../src/data/model.js';

const model = buildModel(data);

test('the curated data resolves with no problem', () => {
  assert.deepEqual(model.problems, []);
});

test('every row is in the model, with all five cells, each with a value, a reason and resolved evidence', () => {
  assert.equal(model.views.size, data.rows.length);
  for (const v of model.views.values()) {
    assert.deepEqual(v.cells.map((c) => c.capability), CAPABILITY_ORDER);
    for (const c of v.cells) {
      assert.ok(['check', 'warning', 'cross', 'not-yet-measured'].includes(c.value), `${v.id} ${c.capability}`);
      assert.match(c.reason, /\S/);
      assert.ok(c.evidence.length >= 1);
      for (const e of c.evidence) assert.ok(model.evidence.get(e.id) === e && e.kind !== 'missing', `${v.id} ${c.capability} ${e.id}`);
    }
  }
});

test('the counts match the data: 37 products, 124 rows, 620 cells', () => {
  const c = modelCounts(model);
  assert.equal(c.products, 37);
  assert.equal(c.rows, 124);
  assert.equal(c.cells, 620);
  assert.equal(c.via, 60);
  assert.equal(c.direct, 64);
  assert.equal(c.evidence, data.evidence.length);
  assert.equal(c.byValue.check + c.byValue.warning + c.byValue.cross + c.byValue['not-yet-measured'], 620);
});

test('all 60 via rows are folded under the direct row of their device, none left over', () => {
  let folded = 0;
  for (const f of model.families) {
    assert.equal(f.orphanVia.length, 0, f.id);
    for (const d of f.hardware) {
      for (const v of d.via) {
        assert.equal(v.row.product, d.row.product);
        assert.equal(v.family, d.family);
        folded++;
      }
    }
  }
  assert.equal(folded, 60);
});

test('a software row lists the devices reached through it', () => {
  const mm = model.views.get('metamask--evm');
  assert.deepEqual(mm.devicesThrough.map((d) => d.id).sort(), ['gridplus--evm--via-metamask', 'keystone--evm--via-metamask', 'ledger--evm--via-metamask', 'trezor--evm--via-metamask']);
});

test('row labels: software by name, hardware direct and via', () => {
  assert.equal(rowLabel(data.rows.find((r) => r.id === 'phantom--solana'), model.products, model.rows), 'Phantom');
  assert.equal(model.views.get('ledger--solana').label, 'Ledger · direct');
  assert.equal(model.views.get('ledger--solana--via-phantom').label, 'Ledger · via Phantom');
});

test('legacy rows come after every other row of their list', () => {
  for (const f of model.families) {
    for (const list of [f.software, f.hardware, ...f.hardware.map((d) => d.via)]) {
      const firstLegacy = list.findIndex((v) => v.legacy);
      if (firstLegacy >= 0) assert.ok(list.slice(firstLegacy).every((v) => v.legacy), f.id);
    }
  }
  assert.ok(model.views.get('mynearwallet--near').legacy);
  assert.ok(model.views.get('secondfi--cardano').legacy);
  assert.ok(!model.views.get('meteor--near').legacy);
});

test('a legacy row listed first in the data is still shown after the others', () => {
  const copy = structuredClone(data);
  const i = copy.rows.findIndex((r) => r.id === 'mynearwallet--near');
  copy.rows.unshift(...copy.rows.splice(i, 1));
  const near = buildModel(copy).families.find((f) => f.id === 'near');
  assert.equal(near.software[0].legacy, false);
  assert.equal(near.software[near.software.length - 1].legacy, true);
});

test('the Cardano family carries its test-only label', () => {
  assert.equal(model.families.find((f) => f.id === 'cardano').testOnly, 'test only, address not bound');
});

test('a broken copy is reported, never filled in', () => {
  const broken = structuredClone(data);
  broken.rows[0].cells.connects.evidence = ['no-such-evidence'];
  delete broken.rows[1].cells.readable;
  broken.rows[2].cells.deterministic.reason = ' ';
  const m = buildModel(broken);
  assert.ok(m.problems.some((p) => p.includes('unknown evidence no-such-evidence')));
  assert.ok(m.problems.some((p) => p.includes(`row ${data.rows[1].id}: no readable cell`)));
  assert.ok(m.problems.some((p) => p.includes(`row ${data.rows[2].id}: deterministic has no reason`)));
});
