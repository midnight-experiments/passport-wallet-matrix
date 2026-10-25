// "Test my wallet" for the Solana arm (sol_ed25519), with the client's own
// rules:
//   - a wallet outside the named families is probed raw first, then with the
//     off-chain message v1 when it advertises version 1 (the client's format
//     probe); a named family (Phantom, Backpack, Solflare) is never probed,
//     and the page signs the probe text once in the format its fixed rule
//     gives; Ledger and Trezor sign the off-chain message v1 only;
//   - `supportedMessageVersions` is read before off-chain v1 is asked;
//   - the privacy-key request for the probe network is signed twice in the
//     enrolment format, and both signatures must be the same;
//   - every answer goes through the client's signer check over the exact
//     bytes asked; a refusal names another wallet's key only when the
//     signature verifies under it.
// The probe text authorises nothing and carries a fresh nonce.

import { PROBE_NETWORK, PROBE_ACCOUNT_INDEX } from '../config.js';
import { fromHex, toHex, randomBytes, base58Encode, equalBytes } from '../bytes.js';
import {
  SOL_SIGN_MESSAGE_FEATURE, SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE, solWalletFamily, solWalletFormats, solStandardSigner, probeSolWalletFormats,
  solFormatProbeText, solFormatProbeBytes, solHardwareSigner, solBlindSignedBytes, checkSolSignature, SignerMismatchError,
  canonicalEd25519Signature, parseSolanaPublicKey,
} from '../vendor.js';
import { step, ask, applyCheck, describeError } from './common.js';

/** The message versions a wallet advertises for off-chain signing, or null. */
export function supportedMessageVersions(features) {
  const f = features?.[SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE];
  if (!f) return null;
  try { return [...(f.supportedMessageVersions ?? [])].map(Number); } catch { return null; }
}

/** Verifies one answer over exactly `bytes`: `verified` or `wrong-signature`. */
export function verifySolAnswer(bytesHex, signatureHex, keyText, candidatesText = []) {
  let sig, bytes;
  try { sig = fromHex(signatureHex); bytes = fromHex(bytesHex); } catch { return { outcome: 'wrong-signature', reason: 'the answer is not a hex signature' }; }
  const others = candidatesText.map((k) => { try { return parseSolanaPublicKey(k); } catch { return null; } }).filter(Boolean);
  try {
    checkSolSignature(bytes, sig, keyText, others);
    return { outcome: 'verified', reason: null };
  } catch (e) {
    if (e instanceof SignerMismatchError && e.signer) return { outcome: 'wrong-signature', reason: e.message, signer: base58Encode(e.signer) };
    return { outcome: 'wrong-signature', reason: e.message };
  }
}

/** Re-checks the steps of a Solana test from their bytes and signatures. */
export function verifySolSteps(steps, identity, candidates = []) {
  for (const s of steps) {
    if (!s.request || s.signature === undefined || s.signature === null) continue;
    for (const k of ['signer', 'sameAsFirst']) delete s[k];
    applyCheck(s, verifySolAnswer(s.request.bytesHex, s.signature, identity.publicKey, candidates));
  }
  const a = steps.find((s) => s.id === 'blind#1'), b = steps.find((s) => s.id === 'blind#2');
  if (a?.outcome === 'verified' && b?.outcome === 'verified') {
    b.sameAsFirst = equalBytes(canonicalEd25519Signature(fromHex(a.signature)), canonicalEd25519Signature(fromHex(b.signature)));
  }
  return steps;
}

/** A wallet whose signing features record every request and answer, so that
 *  the probe's signatures (which the client checks and drops) can be kept in
 *  the visitor's result and checked again on import. */
function recordingWallet(wallet, log) {
  const features = { ...wallet.features };
  const raw = wallet.features?.[SOL_SIGN_MESSAGE_FEATURE];
  if (raw && typeof raw.signMessage === 'function') {
    features[SOL_SIGN_MESSAGE_FEATURE] = { ...raw, signMessage: async (...inputs) => {
      const out = await raw.signMessage(...inputs);
      log.push({ kind: 'raw', message: inputs[0]?.message, answer: out?.[0] });
      return out;
    } };
  }
  const off = wallet.features?.[SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE];
  if (off && typeof off.signOffchainMessage === 'function') {
    features[SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE] = { ...off, supportedMessageVersions: off.supportedMessageVersions, signOffchainMessage: async (...inputs) => {
      const out = await off.signOffchainMessage(...inputs);
      log.push({ kind: 'offchain', text: inputs[0]?.message, answer: out?.[0] });
      return out;
    } };
  }
  return { name: wallet.name, features };
}

const answerSignature = (answer) => {
  const s = answer?.signature;
  if (s instanceof Uint8Array) return toHex(s);
  if (Array.isArray(s)) return toHex(Uint8Array.from(s));
  return null;
};

/**
 * Runs the Solana test. `source` is either
 *   { kind: 'standard', wallet, account? }   a Wallet Standard wallet; or
 *   { kind: 'hardware', family: 'ledger' | 'trezor', publicKey, signOffchain }
 *     a device's off-chain signing (sol-ed25519-wallet.ts solHardwareSigner).
 * `others()` gives the keys other connected wallets report.
 */
export async function testSolana(source, { others = () => [], nonce = randomBytes(32), connectInfo } = {}) {
  const steps = [];
  const connect = step('connect', 'Connect');
  steps.push(connect);
  const reported = {};
  let signer, publicKey, account, probeWallet, log = [];

  if (source.kind === 'standard') {
    const { wallet } = source;
    reported.walletStandardVersion = typeof wallet.version === 'string' ? wallet.version : null;
    reported.supportedMessageVersions = supportedMessageVersions(wallet.features);
    reported.features = Object.keys(wallet.features ?? {}).filter((f) => f.startsWith('solana:') || f.startsWith('standard:')).sort();
    account = source.account;
    if (!account) {
      const res = await ask(connect, async () => {
        const f = wallet.features?.['standard:connect'];
        const r = f ? await f.connect() : { accounts: wallet.accounts };
        return r?.accounts ?? wallet.accounts;
      });
      if (!res) return { steps, identity: null, candidates: [], reported };
      account = [...res].find((a) => a?.publicKey && (a.chains ?? []).some((c) => String(c).startsWith('solana:'))) ?? [...res][0];
    }
    if (!account?.publicKey) { connect.outcome = 'refused'; connect.reason = 'the wallet returned no account'; return { steps, identity: null, candidates: [], reported }; }
    try { publicKey = parseSolanaPublicKey(Uint8Array.from(account.publicKey)); } catch (e) { connect.outcome = 'refused'; connect.reason = `the account key is not a valid Solana key (${e.message})`; return { steps, identity: null, candidates: [], reported }; }
    probeWallet = recordingWallet(wallet, log);
    try { signer = solStandardSigner(probeWallet, account, { others }); } catch (e) { connect.outcome = 'refused'; connect.reason = describeError(e); return { steps, identity: null, candidates: [], reported }; }
    reported.family = solWalletFamily(wallet.name);
  } else if (source.kind === 'hardware') {
    const info = connectInfo ?? {};
    Object.assign(reported, info.surface ?? {});
    publicKey = source.publicKey;
    try { signer = solHardwareSigner({ family: source.family, publicKey, signOffchain: source.signOffchain, others }); } catch (e) { connect.outcome = 'refused'; connect.reason = describeError(e); return { steps, identity: null, candidates: [], reported }; }
    reported.family = source.family;
  } else {
    throw new Error('unknown Solana source');
  }
  connect.outcome = 'ok';
  const identity = { publicKey: base58Encode(publicKey) };
  const candidates = [...(others() ?? [])].map((k) => base58Encode(k)).filter((k) => k !== identity.publicKey);
  reported.formats = [...signer.formats];

  // The format probe.
  const text = solFormatProbeText(publicKey, nonce);
  let format;
  if (source.kind === 'standard' && solWalletFamily(source.wallet.name) === 'other') {
    const probe = await probeSolWalletFormats(probeWallet, account, { others, nonce: () => nonce });
    for (const att of probe.attempts) {
      const bytes = solFormatProbeBytes(att.format, publicKey, text);
      const call = log.find((c) => c.kind === att.format && !c.used);
      if (call) call.used = true;
      const s = step(`probe:${att.format}`, att.format === 'raw' ? 'Format probe, raw signMessage' : 'Format probe, off-chain message v1', {
        method: att.format === 'raw' ? SOL_SIGN_MESSAGE_FEATURE : SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE, format: att.format,
        request: { type: 'sol-bytes', bytesHex: toHex(bytes) },
      });
      const sig = answerSignature(call?.answer);
      if (att.outcome === 'refused' || !sig) { s.outcome = 'refused'; s.reason = att.reason ?? 'refused'; } else { s.signature = sig; applyCheck(s, verifySolAnswer(s.request.bytesHex, sig, identity.publicKey, candidates)); }
      steps.push(s);
    }
    format = probe.format;
    reported.probe = { probed: true, advertised: probe.advertised, ...(probe.message ? { message: probe.message } : {}) };
  } else {
    // A named family or a device: its fixed rule picks the format; the
    // probe text is signed once in it.
    format = signer.formats[0];
    reported.probe = { probed: false, advertised: [...signer.formats] };
    if (format) {
      const bytes = solFormatProbeBytes(format, publicKey, text);
      const s = step(`probe:${format}`, format === 'raw' ? 'Probe text, raw signMessage' : 'Probe text, off-chain message v1', {
        method: source.kind === 'hardware' ? `${source.family} off-chain message` : (format === 'raw' ? SOL_SIGN_MESSAGE_FEATURE : SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE),
        format, request: { type: 'sol-bytes', bytesHex: toHex(bytes) },
      });
      steps.push(s);
      const sig = await ask(s, () => signer.sign(bytes));
      if (sig !== undefined) { s.signature = toHex(sig); applyCheck(s, verifySolAnswer(s.request.bytesHex, s.signature, identity.publicKey, candidates)); }
      if (s.outcome !== 'verified') format = undefined;
    }
  }
  reported.enrolmentFormat = format ?? null;

  // The privacy-key request, twice, in the enrolment format.
  if (format) {
    const bytes = solBlindSignedBytes(publicKey, { network: PROBE_NETWORK, accountIndex: PROBE_ACCOUNT_INDEX }, format);
    for (const id of ['blind#1', 'blind#2']) {
      const s = step(id, id === 'blind#1' ? 'Privacy-key request' : 'Privacy-key request, again', {
        method: source.kind === 'hardware' ? `${source.family} off-chain message` : (format === 'raw' ? SOL_SIGN_MESSAGE_FEATURE : SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE),
        format, request: { type: 'sol-bytes', bytesHex: toHex(bytes) },
      });
      steps.push(s);
      if (id === 'blind#2' && steps.find((x) => x.id === 'blind#1')?.outcome === 'refused') { s.reason = 'not asked again: the first request was refused'; break; }
      const sig = await ask(s, () => signer.sign(bytes));
      if (sig !== undefined) { s.signature = toHex(sig); }
    }
  }
  verifySolSteps(steps, identity, candidates);
  return { steps, identity, candidates, reported };
}

/** The formats the client would ask of a wallet-standard wallet, without
 *  asking it anything (for the detection list). */
export function solFormatsOf(wallet) {
  try { return solWalletFormats({ family: solWalletFamily(wallet?.name), features: wallet?.features }); } catch { return []; }
}
