import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../../../data/wallets.json';
import { buildModel, CAPABILITY_ORDER } from '../../src/data/model.js';
import { liveCells, compareWithBaseline, readable } from '../../src/probe/verdict.js';

const model = buildModel(data);
const S = (id, outcome, extra = {}) => ({ id, label: id, outcome, reason: outcome === 'verified' || outcome === 'ok' ? null : `${id} ${outcome}`, ...extra });
const evm = (t1, t2, p1, p2, same = [true, true]) => [
  S('connect', 'ok'), S('typed#1', t1), S('typed#2', t2, t2 === 'verified' ? { sameAsFirst: same[0] } : {}),
  S('personal#1', p1), S('personal#2', p2, p2 === 'verified' ? { sameAsFirst: same[1] } : {}),
];

test('EVM: everything verifies and repeats: check, check, check', () => {
  const c = liveCells('evm', evm('verified', 'verified', 'verified', 'verified'), { standard: 'EIP-6963' });
  assert.equal(c.connects.value, 'check');
  assert.match(c.connects.reason, /EIP-6963/);
  assert.equal(c['signs-format'].value, 'check');
  assert.equal(c.deterministic.value, 'check');
  assert.equal(c.readable.value, 'not-yet-measured');
  assert.equal(c['on-chain'].value, 'not-yet-measured');
});

test('EVM: typed data refused, personal_sign verified: a warning naming the refusal', () => {
  const c = liveCells('evm', evm('refused', 'skipped', 'verified', 'verified'));
  assert.equal(c['signs-format'].value, 'warning');
  assert.match(c['signs-format'].reason, /typed#1 refused/);
  assert.equal(c.deterministic.value, 'check');
});

test('EVM: a Ledger 0x6a80 refusal carries the blind-signing hint', () => {
  const steps = evm('refused', 'skipped', 'verified', 'verified');
  steps[1].status = '6a80';
  const c = liveCells('evm', steps);
  assert.equal(c['signs-format'].value, 'warning');
  assert.match(c['signs-format'].reason, /0x6a80.*blind signing/);
});

test('EVM: typed data verified, personal_sign refused: a warning', () => {
  const c = liveCells('evm', evm('verified', 'verified', 'refused', 'skipped'));
  assert.equal(c['signs-format'].value, 'warning');
  assert.match(c['signs-format'].reason, /not personal_sign/);
});

test('EVM: a wrong signature anywhere is a cross, even when others verify', () => {
  const c = liveCells('evm', evm('verified', 'verified', 'wrong-signature', 'verified'));
  assert.equal(c['signs-format'].value, 'cross');
  assert.match(c['signs-format'].reason, /does not verify/);
});

test('EVM: both refused: a cross', () => {
  assert.equal(liveCells('evm', evm('refused', 'skipped', 'refused', 'skipped'))['signs-format'].value, 'cross');
});

test('EVM: a pair that differs makes the wallet non-deterministic', () => {
  const c = liveCells('evm', evm('verified', 'verified', 'verified', 'verified', [true, false]));
  assert.equal(c.deterministic.value, 'cross');
  assert.match(c.deterministic.reason, /different signatures/);
  const c2 = liveCells('evm', evm('verified', 'verified', 'verified', 'verified', [false, true]));
  assert.equal(c2.deterministic.value, 'cross');
});

test('determinism is not measured without a verified pair', () => {
  assert.equal(liveCells('evm', evm('refused', 'skipped', 'verified', 'refused')).deterministic.value, 'not-yet-measured');
  assert.equal(liveCells('evm', evm('verified', 'wrong-signature', 'refused', 'skipped')).deterministic.value, 'not-yet-measured');
});

test('a sameAsFirst missing on the second of a pair is not a repeat', () => {
  const steps = evm('verified', 'verified', 'verified', 'verified');
  delete steps[2].sameAsFirst;
  assert.equal(liveCells('evm', steps).deterministic.value, 'cross');
});

test('connect refused: a cross; no connect step: not measured', () => {
  assert.equal(liveCells('evm', [S('connect', 'refused')]).connects.value, 'cross');
  assert.equal(liveCells('evm', []).connects.value, 'not-yet-measured');
});

test('Solana: one verified format is a check; a wrong one beside it a warning; none a cross', () => {
  const base = [S('connect', 'ok'), S('blind#1', 'verified'), S('blind#2', 'verified', { sameAsFirst: true })];
  const raw = S('probe:raw', 'verified', { format: 'raw' });
  assert.equal(liveCells('solana', [...base, raw])['signs-format'].value, 'check');
  assert.match(liveCells('solana', [...base, raw])['signs-format'].reason, /raw signMessage/);
  const off = S('probe:offchain', 'verified', { format: 'offchain' });
  assert.match(liveCells('solana', [...base, S('probe:raw', 'refused', { format: 'raw' }), off])['signs-format'].reason, /off-chain message v1/);
  assert.equal(liveCells('solana', [...base, S('probe:raw', 'refused', { format: 'raw' }), off])['signs-format'].value, 'check');
  assert.equal(liveCells('solana', [...base, S('probe:raw', 'wrong-signature', { format: 'raw' }), off])['signs-format'].value, 'warning');
  assert.equal(liveCells('solana', [...base, S('probe:raw', 'wrong-signature', { format: 'raw' })])['signs-format'].value, 'cross');
  assert.equal(liveCells('solana', [...base, S('probe:raw', 'refused', { format: 'raw' })])['signs-format'].value, 'cross');
  assert.equal(liveCells('solana', base)['signs-format'].value, 'not-yet-measured');
  assert.equal(liveCells('solana', [...base, raw]).deterministic.value, 'check');
  assert.equal(liveCells('solana', [S('connect', 'ok'), raw, S('blind#1', 'verified'), S('blind#2', 'verified', { sameAsFirst: false })]).deterministic.value, 'cross');
});

test('NEAR: the approval-form probe decides the format cell', () => {
  assert.equal(liveCells('near', [S('connect', 'ok'), S('probe', 'verified')])['signs-format'].value, 'check');
  assert.equal(liveCells('near', [S('connect', 'ok'), S('probe', 'wrong-signature')])['signs-format'].value, 'cross');
  assert.equal(liveCells('near', [S('connect', 'ok'), S('probe', 'refused')])['signs-format'].value, 'cross');
  assert.equal(liveCells('near', [S('connect', 'ok')])['signs-format'].value, 'not-yet-measured');
});

test('Cardano: layout 2 is decided by the text, layout 1 by X and the text', () => {
  const l2 = [S('connect', 'ok'), S('probe:text', 'verified', { layout: 2 })];
  assert.equal(liveCells('cardano', l2)['signs-format'].value, 'check');
  assert.match(liveCells('cardano', l2)['signs-format'].reason, /layout 2/);
  const l1ok = [S('connect', 'ok'), S('probe:text', 'verified', { layout: 1 }), S('probe:x-text', 'verified', { layout: 1 })];
  assert.equal(liveCells('cardano', l1ok)['signs-format'].value, 'check');
  const l1bad = [S('connect', 'ok'), S('probe:text', 'verified', { layout: 1 }), S('probe:x-text', 'wrong-signature')];
  assert.equal(liveCells('cardano', l1bad)['signs-format'].value, 'cross');
  assert.equal(liveCells('cardano', [S('connect', 'ok'), S('probe:text', 'wrong-signature')])['signs-format'].value, 'cross');
});

test('a device below the version its arm needs is never a plain check', () => {
  const steps = [S('connect', 'ok'), S('probe:offchain', 'verified', { format: 'offchain' })];
  const c = liveCells('solana', steps, { versionWarning: 'The Ledger Solana app 1.15.0 is older than 1.16.0.' });
  assert.equal(c['signs-format'].value, 'warning');
  assert.match(c['signs-format'].reason, /1\.15\.0/);
  const x = liveCells('solana', [S('connect', 'ok'), S('probe:offchain', 'refused', { format: 'offchain' })], { versionWarning: 'old firmware' });
  assert.equal(x['signs-format'].value, 'cross');
  assert.match(x['signs-format'].reason, /old firmware/);
});

test('readable comes only from the visitor', () => {
  assert.equal(readable('yes').value, 'check');
  assert.equal(readable('partly').value, 'warning');
  assert.equal(readable('no').value, 'cross');
  assert.equal(readable(null).value, 'not-yet-measured');
  assert.equal(readable('verified').value, 'not-yet-measured');
  assert.equal(liveCells('evm', evm('verified', 'verified', 'verified', 'verified'), { readable: 'no' }).readable.value, 'cross');
});

test('the comparison: same, differs, not compared', () => {
  const mm = model.views.get('metamask--evm');
  const live = liveCells('evm', evm('verified', 'verified', 'verified', 'verified', [true, false]), { readable: 'yes' });
  const cmp = compareWithBaseline(live, mm, CAPABILITY_ORDER);
  assert.equal(cmp.rowId, 'metamask--evm');
  assert.equal(cmp.perCapability.connects.verdict, 'same');
  assert.equal(cmp.perCapability['signs-format'].verdict, 'same');
  assert.equal(cmp.perCapability.deterministic.verdict, 'differs');
  assert.equal(cmp.perCapability.readable.verdict, 'differs');
  assert.equal(cmp.perCapability['on-chain'].verdict, 'not-compared');
  assert.deepEqual(cmp.differs, ['readable', 'deterministic']);
  const none = compareWithBaseline(live, null, CAPABILITY_ORDER);
  assert.equal(none.rowId, null);
  assert.deepEqual(none.differs, []);
  const coinbase = model.views.get('coinbase--evm');
  const cb = compareWithBaseline(live, coinbase, CAPABILITY_ORDER);
  assert.equal(cb.perCapability.readable.verdict, 'not-compared');
  assert.equal(cb.perCapability.deterministic.verdict, 'not-compared');
});
