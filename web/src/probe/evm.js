// "Test my wallet" for the EVM arm (evm_k256), with the client's own rules:
//   - an approval is EIP-712 V1 typed data (the fixed domain without
//     chainId) signed with eth_signTypedData_v4; the probe is a
//     rotate_enc_key approval for a random account that does not exist, so
//     it authorises nothing anywhere;
//   - the privacy-key request is signed with personal_sign; the probe signs
//     it for the probe network, whose privacy key belongs to no account;
//   - each is signed twice, and both signatures must be the same;
//   - every answer goes through the client's signer check: the address
//     recovered from the exact digest must be the connected one, and a
//     refusal names another wallet only when the signature recovers to it.
// A signature that does not verify is tried against what a wallet might have
// signed instead, so the result can say why.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { PROBE_NETWORK, PROBE_ACCOUNT_INDEX } from '../config.js';
import { fromHex, toHex, randomBytes, utf8 } from '../bytes.js';
import {
  evmK256Messages, checkEip712V1TypedData, typedDataDigest, checkEvmK256Signer, personalMessageDigest, blindMessageBytes,
  SignerMismatchError, sameCanonicalSignature, evmChecksumAddress, parseEvmAddress, parseEvmSignature, recoverEvmPoint, evmAddressOfPoint,
  hashStruct,
} from '../vendor.js';
import { step, ask, applyCheck } from './common.js';

/** The two probe requests for an address. */
export function evmProbeRequests(address, probeAccount = randomBytes(32), probeKey = randomBytes(32)) {
  const typedData = evmK256Messages.rotateEncKey({ account: probeAccount, device: address, authNonce: 0n }, probeKey);
  checkEip712V1TypedData(typedData);
  const blind = blindMessageBytes({ scheme: 'evm_k256', network: PROBE_NETWORK, identity: address, accountIndex: PROBE_ACCOUNT_INDEX });
  return {
    typed: { type: 'typed-data', typedData: JSON.parse(JSON.stringify(typedData)) },
    personal: { type: 'personal', messageHex: toHex(blind) },
  };
}

/** The digest the wallet was asked to sign. Typed data outside the fixed V1
 *  domain is refused, as the client refuses it before a wallet sees it. */
export function evmRequestDigest(request) {
  if (request?.type === 'typed-data') return typedDataDigest(checkEip712V1TypedData(request.typedData));
  if (request?.type === 'personal') return personalMessageDigest(fromHex(request.messageHex));
  throw new Error('not an EVM probe request');
}

const word = (v) => { const o = new Uint8Array(32); let x = BigInt(v); for (let i = 31; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };

/** The digest of the same typed data under the domain with a chainId, the
 *  form many wallets add: EIP712Domain(string name,string version,uint256
 *  chainId,address verifyingContract). The arm's domain has no chainId. */
export function digestWithChainId(td, chainId) {
  const typeHash = keccak_256(utf8('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
  const domain = keccak_256(new Uint8Array([
    ...typeHash, ...keccak_256(utf8(td.domain.name)), ...keccak_256(utf8(td.domain.version)), ...word(BigInt(chainId)),
    ...new Uint8Array(12), ...fromHex(td.domain.verifyingContract),
  ]));
  const { EIP712Domain: _d, ...types } = td.types;
  return keccak_256(new Uint8Array([0x19, 0x01, ...domain, ...hashStruct(td.primaryType, td.message, types)]));
}

function recovered(digest, sig) {
  try { return evmAddressOfPoint(recoverEvmPoint(digest, parseEvmSignature(sig))); } catch { return null; }
}
const sameAddress = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

/** What a wallet might have signed instead, for a signature that does not
 *  verify: the reason, or null. */
export function explainEvm(request, sig, expected, chainId) {
  const tries = [];
  if (request.type === 'typed-data') {
    const td = request.typedData;
    if (chainId !== undefined && chainId !== null) {
      tries.push([() => digestWithChainId(td, chainId), `it signed the typed data with its chainId ${BigInt(chainId)} added to the domain; the arm's domain has no chainId`]);
    }
    tries.push([() => personalMessageDigest(utf8(JSON.stringify(td))), 'it signed the typed data\'s JSON as personal_sign text']);
  } else {
    const msg = fromHex(request.messageHex);
    tries.push([() => keccak_256(msg), 'it signed the message\'s keccak-256 without the EIP-191 prefix']);
    tries.push([() => personalMessageDigest(utf8('0x' + request.messageHex)), 'it signed the message\'s hex text instead of its bytes']);
    tries.push([() => personalMessageDigest(utf8(new TextDecoder().decode(msg).replace(/\n/g, '\r\n'))), 'it signed the text with CRLF line breaks']);
  }
  for (const [digest, reason] of tries) {
    try { if (sameAddress(recovered(digest(), sig), expected)) return reason; } catch { /* next */ }
  }
  return null;
}

/**
 * Verifies one answer: `verified`, or `wrong-signature` with the reason. A
 * signature longer than 65 bytes is a contract account's (ERC-1271 or
 * ERC-6492), which no key recovery can check.
 */
export function verifyEvmAnswer(request, signatureHex, expectedText, candidatesText = [], chainId = null) {
  let sig;
  try { sig = fromHex(signatureHex); } catch { return { outcome: 'wrong-signature', reason: 'the answer is not a hex signature' }; }
  if (sig.length > 65) return { outcome: 'wrong-signature', reason: `a ${sig.length}-byte signature: a contract account's, which the arm cannot check by key recovery` };
  const expected = parseEvmAddress(expectedText);
  const others = candidatesText.map((c) => { try { return parseEvmAddress(c); } catch { return null; } }).filter(Boolean);
  let digest;
  try { digest = evmRequestDigest(request); } catch (e) { return { outcome: 'wrong-signature', reason: `the request is not one the client sends: ${e.message}` }; }
  try {
    checkEvmK256Signer(expected, digest, sig, others);
    return { outcome: 'verified', reason: null };
  } catch (e) {
    const explained = explainEvm(request, sig, expected, chainId);
    if (e instanceof SignerMismatchError && e.signer) {
      return { outcome: 'wrong-signature', reason: e.message, signer: evmChecksumAddress(e.signer) };
    }
    return { outcome: 'wrong-signature', reason: explained ? `${e.message}; ${explained}` : e.message };
  }
}

const sigText = (v) => {
  if (v instanceof Uint8Array) return toHex(v);
  if (typeof v === 'string') return v.replace(/^0x/i, '').toLowerCase();
  throw new Error('the wallet returned no signature');
};

/** Re-checks the steps of an EVM test from their requests and signatures
 *  alone: outcomes, signers and the sign-twice comparison. */
export function verifyEvmSteps(steps, identity, candidates = [], chainId = null) {
  const by = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps) {
    if (!s.request || s.signature === undefined || s.signature === null) continue;
    for (const k of ['signer', 'sameAsFirst']) delete s[k];
    applyCheck(s, verifyEvmAnswer(s.request, s.signature, identity.address, candidates, chainId));
  }
  for (const [a, b] of [['typed#1', 'typed#2'], ['personal#1', 'personal#2']]) {
    const x = by.get(a), y = by.get(b);
    if (x?.outcome === 'verified' && y?.outcome === 'verified') {
      y.sameAsFirst = sameCanonicalSignature('evm_k256', fromHex(x.signature), fromHex(y.signature));
    }
  }
  return steps;
}

/**
 * Runs the EVM test on a wallet adapter:
 *   connect() -> { address: Uint8Array, chainId?, clientVersion?, surface? }
 *   signTypedData(address, typedData) -> 65-byte signature (bytes or hex)
 *   personalSign(address, message) -> 65-byte signature (bytes or hex)
 *   others?() -> addresses other connected wallets report
 * Returns the steps, the identity, the candidates and what the wallet reported.
 */
export async function testEvm(adapter, { probeAccount, probeKey } = {}) {
  const steps = [];
  const connect = step('connect', 'Connect');
  steps.push(connect);
  const info = await ask(connect, () => adapter.connect());
  if (!info) return { steps, identity: null, candidates: [], reported: {} };
  let address;
  try {
    address = info.address instanceof Uint8Array ? info.address : parseEvmAddress(String(info.address));
    if (address.length !== 20) throw new Error('not 20 bytes');
  } catch (e) {
    connect.outcome = 'refused';
    connect.reason = `the wallet reported no readable address (${e.message})`;
    return { steps, identity: null, candidates: [], reported: {} };
  }
  connect.outcome = 'ok';
  const identity = { address: evmChecksumAddress(address) };
  let candidates = [];
  try { candidates = ((await adapter.others?.()) ?? []).map((a) => evmChecksumAddress(a instanceof Uint8Array ? a : parseEvmAddress(String(a)))); } catch { candidates = []; }
  candidates = candidates.filter((c) => c !== identity.address);
  const chainId = info.chainId ?? null;
  const reqs = evmProbeRequests(address, probeAccount, probeKey);

  const run = async (id, label, method, request, call) => {
    const s = step(id, label, { method, format: request.type === 'typed-data' ? 'eip712-v1' : 'personal_sign', request });
    steps.push(s);
    const answer = await ask(s, call);
    if (answer === undefined) return s;
    try { s.signature = sigText(answer); } catch (e) { s.outcome = 'wrong-signature'; s.reason = e.message; return s; }
    applyCheck(s, verifyEvmAnswer(request, s.signature, identity.address, candidates, chainId));
    return s;
  };
  // A request the wallet refused is not asked again: the second request of
  // a pair only measures whether a signature repeats.
  const again = (first, id, label, method, request, call) => {
    if (first.outcome === 'refused') {
      const s = step(id, label, { method, format: first.format, request, reason: 'not asked again: the first request was refused' });
      steps.push(s);
      return s;
    }
    return run(id, label, method, request, call);
  };
  const typedJson = reqs.typed.typedData;
  const signTyped = () => adapter.signTypedData(address, typedJson);
  const t1 = await run('typed#1', 'V1 typed data', 'eth_signTypedData_v4', reqs.typed, signTyped);
  await again(t1, 'typed#2', 'V1 typed data, again', 'eth_signTypedData_v4', reqs.typed, signTyped);
  const message = fromHex(reqs.personal.messageHex);
  const signPersonal = () => adapter.personalSign(address, message);
  const p1 = await run('personal#1', 'Privacy-key request (personal_sign)', 'personal_sign', reqs.personal, signPersonal);
  await again(p1, 'personal#2', 'Privacy-key request, again', 'personal_sign', reqs.personal, signPersonal);
  verifyEvmSteps(steps, identity, candidates, chainId);
  return {
    steps,
    identity,
    candidates,
    reported: {
      ...(info.chainId !== undefined ? { chainId: String(info.chainId) } : {}),
      ...(info.clientVersion ? { clientVersion: String(info.clientVersion).slice(0, 120) } : {}),
      ...(info.surface ?? {}),
    },
    chainId,
  };
}

/** An EIP-1193 provider (an injected wallet) as an adapter. */
export function eip1193Adapter(provider, { others } = {}) {
  let accountText = null;
  return {
    async connect() {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('the wallet returned no account');
      accountText = String(accounts[0]);
      let chainId = null, clientVersion = null;
      try { chainId = await provider.request({ method: 'eth_chainId' }); } catch { /* optional */ }
      try { clientVersion = await Promise.race([provider.request({ method: 'web3_clientVersion' }), new Promise((r) => setTimeout(() => r(null), 3000))]); } catch { /* optional */ }
      return { address: parseEvmAddress(accountText), chainId, clientVersion };
    },
    signTypedData: (address, typedData) => provider.request({ method: 'eth_signTypedData_v4', params: [accountText ?? evmChecksumAddress(address), JSON.stringify(typedData)] }),
    personalSign: (address, message) => provider.request({ method: 'personal_sign', params: ['0x' + toHex(message), accountText ?? evmChecksumAddress(address)] }),
    others: others ?? (async () => []),
  };
}

/** The accounts an EIP-1193 provider reports without a prompt. */
export async function quietAccounts(provider) {
  try {
    const a = await Promise.race([provider.request({ method: 'eth_accounts' }), new Promise((r) => setTimeout(() => r([]), 1500))]);
    return Array.isArray(a) ? a.map((x) => fromHex(String(x))).filter((b) => b.length === 20) : [];
  } catch {
    return [];
  }
}

