// Shared parts of the family probes: asking a wallet, recording a step, and
// describing a wallet's error without trusting its shape.

/** A wallet error as one line: its code (EIP-1193, CIP-30, a Ledger status
 *  word, a Trezor code) and its message, cut to a readable length. */
export function describeError(e) {
  if (e === undefined || e === null) return 'the wallet answered with no value';
  if (typeof e === 'string') return e.slice(0, 300);
  const parts = [];
  try {
    if (typeof e.statusCode === 'number') parts.push(`status 0x${e.statusCode.toString(16).padStart(4, '0')}`);
    if (e.code !== undefined && e.code !== null && typeof e.code !== 'object') parts.push(`code ${String(e.code)}`);
    const msg = e.message ?? e.info ?? e.error ?? (typeof e.toString === 'function' && e.toString !== Object.prototype.toString ? e.toString() : null);
    if (msg) parts.push(String(msg));
    else parts.push(JSON.stringify(e).slice(0, 200));
  } catch {
    parts.push('an unreadable error');
  }
  return parts.join(': ').slice(0, 300);
}

/** The status word of a Ledger error, as four hex digits, or null. */
export function ledgerStatus(e) {
  const s = e?.statusCode;
  return typeof s === 'number' ? s.toString(16).padStart(4, '0') : null;
}

/** Runs one wallet request with a time limit; the wallet's own prompt can
 *  take as long as the visitor needs, so the limit is generous. */
export async function withTimeout(promise, ms, what) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what}: no answer in ${Math.round(ms / 1000)} s`)), ms); }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export const WALLET_TIMEOUT_MS = 5 * 60 * 1000;

/** A new step record. */
export const step = (id, label, fields = {}) => ({ id, label, outcome: 'skipped', reason: null, ...fields });

/** Asks the wallet (`fn`) for one answer and records a refusal on `s`. Returns
 *  the answer, or undefined when the wallet refused or failed. */
export async function ask(s, fn, what = s.label) {
  try {
    return await withTimeout(Promise.resolve().then(fn), WALLET_TIMEOUT_MS, what);
  } catch (e) {
    s.outcome = 'refused';
    s.reason = describeError(e);
    const sw = ledgerStatus(e);
    if (sw) s.status = sw;
    return undefined;
  }
}

/** Applies a verification `{ outcome, reason, ... }` to a step. */
export function applyCheck(s, check) {
  s.outcome = check.outcome;
  s.reason = check.reason ?? null;
  for (const [k, v] of Object.entries(check)) if (k !== 'outcome' && k !== 'reason') s[k] = v;
  return s;
}
