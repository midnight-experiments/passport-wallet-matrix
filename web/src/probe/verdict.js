// The verdict of a live test: the five capability cells, from the steps of
// one test, and their comparison with a curated row.
//
// A step's outcome is set by the family's verification (probe/<family>.js),
// never by the wallet's word:
//   verified        the signature verifies, under the expected key, over
//                   exactly the bytes the wallet was asked to sign;
//   wrong-signature the wallet answered, but the answer does not verify (another
//                   key, other bytes, another format, a malformed signature);
//   refused         the wallet declined or failed, with its reason;
//   skipped         not asked (a format the wallet cannot sign, or an earlier
//                   step failed).
// A connect step is ok or refused.
//
// The verdict never upgrades "the signature is valid" into "the text was
// shown readably": only the visitor's own answer fills the readable cell.

export const LIVE_VALUES = Object.freeze(['check', 'warning', 'cross', 'not-yet-measured']);

const cell = (value, reason) => ({ value, reason });
const isVerified = (s) => s?.outcome === 'verified';
const isWrong = (s) => s?.outcome === 'wrong-signature';
const stepById = (steps) => new Map(steps.map((s) => [s.id, s]));
const why = (s) => (s?.reason ? `: ${s.reason}` : '');

/** The pairs of steps that sign the same request twice, per family. */
export const DETERMINISM_PAIRS = Object.freeze({
  evm: [['typed#1', 'typed#2'], ['personal#1', 'personal#2']],
  solana: [['blind#1', 'blind#2']],
  near: [['blind#1', 'blind#2']],
  cardano: [['blind#1', 'blind#2']],
});

function connects(steps, meta) {
  const c = stepById(steps).get('connect');
  if (!c) return cell('not-yet-measured', 'The page did not try to connect.');
  if (c.outcome !== 'ok') return cell('cross', `The wallet did not connect${why(c)}.`);
  const via = meta.standard ? ` through ${meta.standard}` : '';
  return cell('check', `Connected${via}.`);
}

function signsFormatEvm(by) {
  const typed = [by.get('typed#1'), by.get('typed#2')].filter(Boolean);
  const personal = [by.get('personal#1'), by.get('personal#2')].filter(Boolean);
  if (typed.length === 0 && personal.length === 0) return cell('not-yet-measured', 'Nothing was signed.');
  const wrong = [...typed, ...personal].find(isWrong);
  if (wrong) return cell('cross', `The wallet answered with a signature that does not verify (${wrong.label ?? wrong.id})${why(wrong)}.`);
  const t = typed.some(isVerified), p = personal.some(isVerified);
  if (t && p) return cell('check', 'Signed the V1 typed data (eth_signTypedData_v4) and the personal_sign request; both verify under the connected address.');
  if (p) {
    const r = typed.find((s) => !isVerified(s));
    const hint = r?.status === '6a80' ? ' (0x6a80: the Ledger Ethereum app cannot clear-sign this typed data; it signs it only with blind signing switched on in the app\'s settings, after a warning)' : '';
    return cell('warning', `Signs personal_sign, but not the V1 typed data that every approval uses${why(r)}${hint}.`);
  }
  if (t) {
    const r = personal.find((s) => !isVerified(s));
    return cell('warning', `Signs the V1 typed data, but not personal_sign, which the privacy-key request uses${why(r)}.`);
  }
  const r = typed[0] ?? personal[0];
  return cell('cross', `Signed neither the V1 typed data nor personal_sign${why(r)}.`);
}

function signsFormatSolana(steps) {
  const probes = steps.filter((s) => s.id.startsWith('probe:'));
  if (probes.length === 0) return cell('not-yet-measured', 'No format was asked: the wallet offers neither raw message signing nor the off-chain message v1.');
  const ok = probes.filter(isVerified);
  const wrong = probes.find(isWrong);
  const name = (s) => (s.format === 'offchain' ? 'the off-chain message v1' : 'raw signMessage');
  if (ok.length > 0) {
    const formats = ok.map(name).join(' and ');
    if (wrong) return cell('warning', `Signs ${formats}, but answered ${name(wrong)} with a signature that does not verify${why(wrong)}.`);
    return cell('check', `Signs ${formats}; the signature verifies under the account key.`);
  }
  if (wrong) return cell('cross', `Answered with a signature that does not verify (${name(wrong)})${why(wrong)}.`);
  return cell('cross', `Signed no format the Solana arm verifies${why(probes[probes.length - 1])}.`);
}

function signsFormatSingle(step, what) {
  if (!step) return cell('not-yet-measured', 'The approval-form probe was not asked.');
  if (isVerified(step)) return cell('check', `${what}; the signature verifies under the wallet's key.`);
  if (isWrong(step)) return cell('cross', `Answered with a signature the arm would refuse${why(step)}.`);
  return cell('cross', `Did not sign the approval-form probe${why(step)}.`);
}

function signsFormat(family, steps, meta) {
  const by = stepById(steps);
  let c;
  if (family === 'evm') c = signsFormatEvm(by);
  else if (family === 'solana') c = signsFormatSolana(steps);
  else if (family === 'near') c = signsFormatSingle(by.get('probe'), 'Signed NEP-413 with callbackUrl absent');
  else if (family === 'cardano') {
    const text = by.get('probe:text');
    const approval = text && isVerified(text) && text.layout === 2 ? text : by.get('probe:x-text') ?? text;
    c = signsFormatSingle(approval, `Signed CIP-8 unhashed through the reward address, in protected-header layout ${approval?.layout ?? '?'}`);
  } else throw new Error(`unknown family ${family}`);
  // A device below the version the arm needs is never a plain check.
  if (meta.versionWarning) {
    if (c.value === 'check') return cell('warning', `${c.reason} But: ${meta.versionWarning}`);
    if (c.value === 'cross' || c.value === 'warning') return cell(c.value, `${c.reason} ${meta.versionWarning}`);
  }
  return c;
}

function deterministic(family, steps) {
  const by = stepById(steps);
  const pairs = DETERMINISM_PAIRS[family] ?? [];
  let measured = 0;
  for (const [a, b] of pairs) {
    const first = by.get(a), second = by.get(b);
    if (!isVerified(first) || !isVerified(second)) continue;
    measured++;
    if (second.sameAsFirst !== true) {
      return cell('cross', `Signed the same request twice with different signatures (${second.label ?? b}): a blind derived from one signature could never be derived again, so this wallet cannot hold a Passport device.`);
    }
  }
  if (measured === 0) return cell('not-yet-measured', 'No request was signed twice with verifying signatures.');
  return cell('check', measured > 1 ? 'Every request signed twice gave the same signature.' : 'The request signed twice gave the same signature.');
}

/** The readable cell: only the visitor can say what the wallet showed. */
export function readable(answer) {
  switch (answer) {
    case 'yes': return cell('check', 'The visitor reports that the wallet showed the text readably before signing.');
    case 'partly': return cell('warning', 'The visitor reports that the wallet showed the text only in part (cut, as hex, or without its line breaks).');
    case 'no': return cell('cross', 'The visitor reports that the wallet did not show the text readably (hashes, raw bytes or nothing).');
    default: return cell('not-yet-measured', 'Only the visitor can tell what the wallet showed; a valid signature says nothing about the display.');
  }
}

const ON_CHAIN = cell('not-yet-measured', 'Measured only by the account operations on a chain; this test signs nothing that reaches a chain.');

/** The five cells of a live test. */
export function liveCells(family, steps, meta = {}) {
  return {
    connects: connects(steps, meta),
    'signs-format': signsFormat(family, steps, meta),
    readable: readable(meta.readable),
    deterministic: deterministic(family, steps),
    'on-chain': ON_CHAIN,
  };
}

/**
 * The live cells beside a curated row's: per capability `same`, `differs`,
 * or `not-compared` when either side is not yet measured. `differs` lists
 * the capabilities whose values differ, in the capability order.
 */
export function compareWithBaseline(live, baselineView, order) {
  if (!baselineView) return { rowId: null, label: null, perCapability: {}, differs: [] };
  const perCapability = {};
  const differs = [];
  for (const cap of order) {
    const b = baselineView.cells.find((c) => c.capability === cap)?.value ?? 'not-yet-measured';
    const l = live[cap]?.value ?? 'not-yet-measured';
    let verdict;
    if (b === 'not-yet-measured' || l === 'not-yet-measured') verdict = 'not-compared';
    else if (b === l) verdict = 'same';
    else verdict = 'differs';
    perCapability[cap] = { baseline: b, live: l, verdict };
    if (verdict === 'differs') differs.push(cap);
  }
  return { rowId: baselineView.id, label: baselineView.label, perCapability, differs };
}
