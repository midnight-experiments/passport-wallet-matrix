// "Test my wallet" for the Cardano arm (provisional: the arm is not built
// yet, and it is test only: it cannot bind an address to its key in-circuit).
// Through CIP-30 signData and the reward address only:
//   1. the probe text alone, which shows the wallet's protected-header layout
//      and its key (layout 2 signs approvals this way);
//   2. for a layout-1 wallet, X || the probe text, the layout-1 approval form;
//   3. the privacy-key request for the probe network (never with X), twice.
// Every answer is checked as the arm will check it: the COSE_Sign1 strictly
// decoded, the payload unhashed and exactly the one asked, the header an
// accepted layout naming the reward address, the key the one that signed
// first, and strict Ed25519 over the Sig_structure.

import { PROBE_NETWORK, PROBE_ACCOUNT_INDEX } from '../config.js';
import { fromHex, toHex, randomBytes, equalBytes } from '../bytes.js';
import { parseCoseSign1, parseCoseKey, cip8SigStructure, cip8Layout, isRewardAddress, verifyEd25519Strict } from './envelopes.js';
import { cardanoProbeText, cardanoApprovalPayload, cardanoBlindPayload, PROVISIONAL_NOTE } from './provisional.js';
import { step, ask, applyCheck } from './common.js';

/** Verifies one signData answer. */
export function verifyCardanoAnswer(request, answer, identityKeyHex) {
  let cose, key;
  try { cose = parseCoseSign1(answer?.coseSign1Hex ?? ''); } catch (e) { return { outcome: 'wrong-signature', reason: `the COSE_Sign1 does not decode strictly (${e.message})` }; }
  try { key = parseCoseKey(answer?.coseKeyHex ?? ''); } catch (e) { return { outcome: 'wrong-signature', reason: `the COSE_Key is not an Ed25519 key (${e.message})` }; }
  const addr = fromHex(request.addressHex);
  const payload = fromHex(request.payloadHex);
  if (cose.hashed) return { outcome: 'wrong-signature', reason: 'the payload is hashed (BLAKE2b-224, "hashed": true), which the Cardano arm cannot rebuild in-circuit and refuses' };
  if (cose.hashedValue !== undefined && cose.hashedValue !== false) return { outcome: 'wrong-signature', reason: 'the unprotected "hashed" value is not a boolean' };
  if (!equalBytes(cose.payload, payload)) return { outcome: 'wrong-signature', reason: 'the wallet signed another payload than the one asked' };
  if (!isRewardAddress(addr)) return { outcome: 'wrong-signature', reason: 'the request was not made through a reward address' };
  const layout = cip8Layout(cose.protectedBytes, addr);
  if (layout === null) return { outcome: 'wrong-signature', reason: 'the protected header is not an accepted layout for the reward address (another address, or another header)' };
  if (identityKeyHex && toHex(key) !== identityKeyHex) return { outcome: 'wrong-signature', reason: `signed with another key (${toHex(key)}) than the one that signed first`, signer: toHex(key) };
  if (!verifyEd25519Strict(cose.signature, cip8SigStructure(cose.protectedBytes, cose.payload), key)) return { outcome: 'wrong-signature', reason: 'the signature does not verify over the Sig_structure' };
  return { outcome: 'verified', reason: null, layout, signatureHex: toHex(cose.signature) };
}

export function verifyCardanoSteps(steps, identity) {
  for (const s of steps) {
    if (!s.request || !s.answer) continue;
    for (const k of ['layout', 'signatureHex', 'sameAsFirst', 'signer']) delete s[k];
    applyCheck(s, verifyCardanoAnswer(s.request, s.answer, identity?.keyHex ?? null));
  }
  const a = steps.find((s) => s.id === 'blind#1'), b = steps.find((s) => s.id === 'blind#2');
  if (a?.outcome === 'verified' && b?.outcome === 'verified') b.sameAsFirst = a.signatureHex === b.signatureHex;
  return steps;
}

/** The network a reward address names (its header's low nibble). */
const addressNetwork = (addr) => ((addr[0] & 0x0f) === 1 ? 'mainnet' : 'testnet');

/**
 * Runs the Cardano test on a CIP-30 API (the object `enable()` returns):
 * getRewardAddresses(), getNetworkId(), signData(addressHex, payloadHex).
 */
export async function testCardano(api, { probeNonce = randomBytes(32), enable } = {}) {
  const steps = [];
  const reported = { provisional: PROVISIONAL_NOTE, testOnly: 'test only, address not bound' };
  const connect = step('connect', 'Connect');
  steps.push(connect);
  const cip30 = await ask(connect, () => (enable ? enable() : api));
  if (!cip30) return { steps, identity: null, candidates: [], reported };
  let reward;
  const addrs = await ask(connect, () => cip30.getRewardAddresses());
  if (addrs === undefined) return { steps, identity: null, candidates: [], reported };
  try {
    reward = fromHex(String(addrs?.[0] ?? ''));
    if (!isRewardAddress(reward)) throw new Error('not a 29-byte reward address');
  } catch (e) {
    connect.outcome = 'refused';
    connect.reason = `the wallet offers no reward address (${e.message})`;
    return { steps, identity: null, candidates: [], reported };
  }
  connect.outcome = 'ok';
  try { reported.networkId = Number(await cip30.getNetworkId()); } catch { /* optional */ }
  reported.addressNetwork = addressNetwork(reward);
  const addressHex = toHex(reward);

  const sign = async (id, label, payload) => {
    const s = step(id, label, { method: 'signData (CIP-30)', format: 'cip8', request: { type: 'cip8', addressHex, payloadHex: toHex(payload) } });
    steps.push(s);
    const ans = await ask(s, () => cip30.signData(addressHex, toHex(payload)));
    if (ans === undefined) return s;
    s.answer = { coseSign1Hex: String(ans?.signature ?? ''), coseKeyHex: String(ans?.key ?? '') };
    return s;
  };

  const text = cardanoProbeText(reward, probeNonce);
  const first = await sign('probe:text', 'Probe text (layout check)', cardanoApprovalPayload(2, text));
  let identity = null, layout = null;
  if (first.answer) {
    const c = verifyCardanoAnswer(first.request, first.answer, null);
    if (c.outcome === 'verified') {
      layout = c.layout;
      identity = { keyHex: toHex(parseCoseKey(first.answer.coseKeyHex)), rewardAddressHex: addressHex };
    }
  }
  if (identity && layout === 1) await sign('probe:x-text', 'Approval-form probe (X and the text)', cardanoApprovalPayload(1, text));
  if (identity) {
    const pk = fromHex(identity.keyHex);
    const b1 = await sign('blind#1', 'Privacy-key request', cardanoBlindPayload(pk, PROBE_NETWORK, PROBE_ACCOUNT_INDEX));
    if (b1.outcome === 'refused') steps.push(step('blind#2', 'Privacy-key request, again', { reason: 'not asked again: the first request was refused' }));
    else await sign('blind#2', 'Privacy-key request, again', cardanoBlindPayload(pk, PROBE_NETWORK, PROBE_ACCOUNT_INDEX));
  }
  reported.layout = layout;
  verifyCardanoSteps(steps, identity);
  return { steps, identity, candidates: [], reported };
}
