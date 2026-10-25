// "Test my wallet" for the NEAR arm (provisional: the arm is not built yet).
// The texts, recipients and nonces come from probe/provisional.js:
//   - an approval-form NEP-413 probe for a probe account that does not
//     exist, with callbackUrl absent;
//   - the privacy-key request for the probe network, signed twice.
// Every answer is checked as the arm will check it: strict Ed25519 over the
// NEP-413 digest with callbackUrl absent, under the key the wallet signed
// with first. A signature over a payload with callbackUrl set is explained
// as such and refused.

import { PROBE_NETWORK, PROBE_ACCOUNT_INDEX } from '../config.js';
import { fromHex, toHex, randomBytes, equalBytes } from '../bytes.js';
import { nep413Digest, parseNearPublicKey, parseNearSignature, verifyEd25519Strict, nearPublicKeyText } from './envelopes.js';
import { nearProbePayload, nearBlindPayload, PROVISIONAL_NOTE } from './provisional.js';
import { step, ask, applyCheck } from './common.js';

const payloadOf = (r) => ({ message: r.message, recipient: r.recipient, nonce: fromHex(r.nonceHex), callbackUrl: null });

/** Verifies one NEP-413 answer. `pageUrl` is the callbackUrl a wallet might
 *  have added; a signature over it is explained, and refused. */
export function verifyNearAnswer(request, answer, identityKeyText, pageUrl = null) {
  let pk, sig;
  try { pk = parseNearPublicKey(answer?.publicKey); } catch (e) { return { outcome: 'wrong-signature', reason: `the answer names no readable key (${e.message})` }; }
  try { sig = fromHex(answer?.signatureHex ?? ''); if (sig.length !== 64) throw new Error('not 64 bytes'); } catch { return { outcome: 'wrong-signature', reason: 'the answer has no 64-byte signature' }; }
  if (identityKeyText && !equalBytes(pk, parseNearPublicKey(identityKeyText))) {
    return { outcome: 'wrong-signature', reason: `signed with ${answer.publicKey}, not the key ${identityKeyText} that signed first`, signer: answer.publicKey };
  }
  const p = payloadOf(request);
  if (verifyEd25519Strict(sig, nep413Digest(p), pk)) return { outcome: 'verified', reason: null };
  if (pageUrl && verifyEd25519Strict(sig, nep413Digest({ ...p, callbackUrl: pageUrl }), pk)) {
    return { outcome: 'wrong-signature', reason: `the wallet signed the payload with callbackUrl set (${pageUrl}), which the NEAR arm refuses` };
  }
  return { outcome: 'wrong-signature', reason: 'the signature does not verify over the NEP-413 payload asked (callbackUrl absent)' };
}

export function verifyNearSteps(steps, identity, pageUrl = null) {
  for (const s of steps) {
    if (!s.request || !s.answer) continue;
    delete s.sameAsFirst;
    applyCheck(s, verifyNearAnswer(s.request, s.answer, identity?.publicKey ?? null, pageUrl));
  }
  const a = steps.find((s) => s.id === 'blind#1'), b = steps.find((s) => s.id === 'blind#2');
  if (a?.outcome === 'verified' && b?.outcome === 'verified') b.sameAsFirst = a.answer.signatureHex === b.answer.signatureHex;
  return steps;
}

const requestOf = (p) => ({ type: 'nep413', message: p.message, recipient: p.recipient, nonceHex: toHex(p.nonce), callbackUrl: null });

/**
 * Runs the NEAR test on an adapter:
 *   connect() -> { accountId? }   (may be a no-op)
 *   signMessage({ message, recipient, nonce }) -> { accountId, publicKey, signature }
 */
export async function testNear(adapter, { pageUrl = null, probeAccount = randomBytes(32), probeNonce = randomBytes(32) } = {}) {
  const steps = [];
  const reported = { provisional: PROVISIONAL_NOTE };
  const connect = step('connect', 'Connect');
  steps.push(connect);
  const info = await ask(connect, () => adapter.connect());
  if (info === undefined) return { steps, identity: null, candidates: [], reported };
  connect.outcome = 'ok';
  if (info?.accountId) reported.accountId = String(info.accountId).slice(0, 80);

  const sign = async (id, label, payload) => {
    const s = step(id, label, { method: 'signMessage (NEP-413)', format: 'nep413', request: requestOf(payload) });
    steps.push(s);
    const ans = await ask(s, () => adapter.signMessage({ message: payload.message, recipient: payload.recipient, nonce: payload.nonce }));
    if (ans === undefined) return s;
    try {
      s.answer = { publicKey: String(ans.publicKey), signatureHex: toHex(parseNearSignature(ans.signature)) };
      if (ans.accountId) reported.accountId = String(ans.accountId).slice(0, 80);
    } catch (e) {
      s.outcome = 'wrong-signature';
      s.reason = e.message;
    }
    return s;
  };

  const probe = await sign('probe', 'Approval-form probe (NEP-413)', nearProbePayload(probeAccount, probeNonce));
  // The key is taken only from a probe answer that verifies; an answer that
  // does not is never a reason to ask for more signatures.
  let identity = null;
  if (probe.answer && verifyNearAnswer(probe.request, probe.answer, null, null).outcome === 'verified') {
    identity = { publicKey: nearPublicKeyText(parseNearPublicKey(probe.answer.publicKey)) };
  }
  if (identity) {
    const pk = parseNearPublicKey(identity.publicKey);
    const b1 = await sign('blind#1', 'Privacy-key request', nearBlindPayload(pk, PROBE_NETWORK, PROBE_ACCOUNT_INDEX));
    if (b1.outcome === 'refused') steps.push(step('blind#2', 'Privacy-key request, again', { reason: 'not asked again: the first request was refused' }));
    else await sign('blind#2', 'Privacy-key request, again', nearBlindPayload(pk, PROBE_NETWORK, PROBE_ACCOUNT_INDEX));
  }
  verifyNearSteps(steps, identity, pageUrl);
  return { steps, identity, candidates: [], reported, pageUrl };
}
