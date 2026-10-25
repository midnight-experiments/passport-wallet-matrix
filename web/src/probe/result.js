// The visitor's live result: one test of one wallet, kept in the page and
// exportable as a JSON file. Nothing is sent anywhere.
//
// The file is self-checking: on import every signature is verified again
// from the request it answers (the family's own verification), and the
// verdict is computed again from those outcomes. A file whose recorded
// verdict does not follow from its signatures is refused, so an edited file
// cannot pass for a test.
//
// The file holds the wallet's public address or key and the probe
// signatures. They authorise nothing (the probes name a probe network and
// accounts that do not exist), but they identify the wallet.

import { RESULT_FORMAT, RESULT_VERSION } from '../config.js';
import { CAPABILITY_ORDER } from '../data/model.js';
import { liveCells, compareWithBaseline } from './verdict.js';
import { verifyEvmSteps } from './evm.js';
import { verifySolSteps } from './solana.js';
import { verifyNearSteps } from './near.js';
import { verifyCardanoSteps } from './cardano.js';
import { versionWarning } from '../hw/versions.js';

export const FAMILY_ARMS = Object.freeze({ evm: 'evm_k256', solana: 'sol_ed25519', near: 'nea_ed25519', cardano: 'cdo_ed25519' });
const PROVISIONAL_FAMILIES = new Set(['near', 'cardano']);
const READABLE_ANSWERS = new Set(['yes', 'partly', 'no', null]);

const clone = (x) => JSON.parse(JSON.stringify(x));

/** The verdict inputs that do not come from the steps. */
function metaOf(r) {
  return { standard: r.wallet?.standard ?? null, readable: r.readable ?? null, versionWarning: versionWarning(r.wallet?.hardware ?? null) };
}

/** Builds a result from a finished test. `wallet` describes what was tested
 *  (no live objects); `baselineView` is the curated row it is compared with,
 *  or null. */
export function makeResult({ family, test, wallet, readable = null, baselineView = null, page = {}, createdAt = new Date().toISOString() }) {
  if (!FAMILY_ARMS[family]) throw new Error(`unknown family ${family}`);
  const r = {
    format: RESULT_FORMAT,
    version: RESULT_VERSION,
    createdAt,
    page,
    family,
    arm: FAMILY_ARMS[family],
    provisional: PROVISIONAL_FAMILIES.has(family),
    ...(family === 'cardano' ? { testOnly: 'test only, address not bound' } : {}),
    wallet: clone(wallet ?? {}),
    identity: test.identity ? clone(test.identity) : null,
    candidates: [...(test.candidates ?? [])],
    reported: clone(test.reported ?? {}),
    ...(test.pageUrl ? { pageUrl: test.pageUrl } : {}),
    ...(test.chainId !== undefined && test.chainId !== null ? { chainId: String(test.chainId) } : {}),
    steps: clone(test.steps),
    readable,
    cells: null,
    comparison: null,
  };
  r.cells = liveCells(family, r.steps, metaOf(r));
  r.comparison = compareWithBaseline(r.cells, baselineView, CAPABILITY_ORDER);
  return r;
}

/** The visitor's answer to "was it readable", applied to a result. */
export function withReadable(r, answer, baselineView = null) {
  if (!READABLE_ANSWERS.has(answer)) throw new Error('the readable answer is yes, partly, no or none');
  const out = clone(r);
  out.readable = answer;
  out.cells = liveCells(out.family, out.steps, metaOf(out));
  out.comparison = compareWithBaseline(out.cells, baselineView, CAPABILITY_ORDER);
  return out;
}

export const exportResult = (r) => `${JSON.stringify(r, null, 2)}\n`;

export const resultFileName = (r) => {
  const who = String(r.wallet?.reported?.name ?? r.wallet?.standard ?? 'wallet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'wallet';
  return `wallet-matrix-${r.family}-${who}-${String(r.createdAt).replace(/[:.]/g, '-')}.json`;
};

/** Re-checks every step of a result from its requests and answers. */
export function reverify(r) {
  const steps = clone(r.steps);
  switch (r.family) {
    case 'evm': verifyEvmSteps(steps, r.identity ?? { address: null }, r.candidates ?? [], r.chainId ?? null); break;
    case 'solana': verifySolSteps(steps, r.identity ?? { publicKey: null }, r.candidates ?? []); break;
    case 'near': verifyNearSteps(steps, r.identity, r.pageUrl ?? null); break;
    case 'cardano': verifyCardanoSteps(steps, r.identity); break;
    default: throw new Error(`unknown family ${r.family}`);
  }
  return steps;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reads an exported file: checks its form, verifies every signature again,
 * computes the verdict again, and refuses the file when either differs from
 * what it records. Returns the result, compared with `baselineView`.
 */
export function importResult(text, baselineView = null) {
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('the file is not JSON'); }
  if (r?.format !== RESULT_FORMAT) throw new Error(`not a ${RESULT_FORMAT} file`);
  if (r.version !== RESULT_VERSION) throw new Error(`version ${r.version} is not supported (this page reads version ${RESULT_VERSION})`);
  if (!FAMILY_ARMS[r.family] || r.arm !== FAMILY_ARMS[r.family]) throw new Error('the family and arm do not match');
  if (!Array.isArray(r.steps) || r.steps.some((s) => typeof s?.id !== 'string')) throw new Error('the file has no steps');
  if (!READABLE_ANSWERS.has(r.readable ?? null)) throw new Error('the readable answer is not one the page records');
  const steps = reverify(r);
  const strip = (list) => list.map(({ outcome, reason, signer, sameAsFirst, layout, signatureHex, id }) => ({ id, outcome, reason: reason ?? null, signer: signer ?? null, sameAsFirst: sameAsFirst ?? null, layout: layout ?? null, signatureHex: signatureHex ?? null }));
  if (!sameJson(strip(steps), strip(r.steps))) throw new Error('a recorded step does not follow from its signature (the file was changed, or made by another page)');
  const cells = liveCells(r.family, steps, metaOf(r));
  if (!sameJson(cells, r.cells)) throw new Error('the recorded verdict does not follow from the steps (the file was changed, or made by another page)');
  return { ...r, steps, cells, comparison: compareWithBaseline(cells, baselineView, CAPABILITY_ORDER) };
}
