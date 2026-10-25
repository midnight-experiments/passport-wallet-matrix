// Signing envelopes the NEAR and Cardano probes check: NEP-413 and CIP-8
// (COSE_Sign1 over CIP-30 signData), with a strict CBOR subset and strict
// Ed25519 verification. The EVM and Solana envelopes come from the vendored
// client (src/vendor.js).
//
// NEP-413: the wallet signs SHA-256(u32le(2^31 + 413) || Borsh(payload)),
// payload = { message: string, nonce: [u8; 32], recipient: string,
// callbackUrl: Option<string> }.
//
// CIP-8: the signature covers Sig_structure = ["Signature1", protected (bstr),
// external_aad (empty bstr), payload (bstr)], CBOR-encoded, where `protected`
// is the header map's bytes exactly as the wallet wrote them. With
// `hashed: true` in the unprotected header the payload is BLAKE2b-224 of the
// message, which no Passport circuit can rebuild.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8, fromUtf8, concat, equalBytes, u32le, base58Encode, base58Decode, base64Decode, fromHex, toHex } from '../bytes.js';

// ── Ed25519 ─────────────────────────────────────────────────────────────────

const L = ed25519.Point.Fn.ORDER;
const leInt = (b) => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; };

/** Strict RFC 8032 verification: canonical R and A in the prime-order
 *  subgroup, S below L, cofactorless (no ZIP-215 leniency). */
export function verifyEd25519Strict(sig, msg, pk) {
  if (!(sig instanceof Uint8Array) || sig.length !== 64 || !(pk instanceof Uint8Array) || pk.length !== 32) return false;
  if (leInt(sig.subarray(32)) >= L) return false;
  try {
    const R = ed25519.Point.fromBytes(sig.subarray(0, 32), false);
    const A = ed25519.Point.fromBytes(pk, false);
    if (!equalBytes(R.toBytes(), sig.subarray(0, 32)) || !equalBytes(A.toBytes(), pk)) return false;
    if (A.is0() || A.isSmallOrder() || !A.isTorsionFree() || R.isSmallOrder() || !R.isTorsionFree()) return false;
    return ed25519.verify(sig, msg, pk, { zip215: false });
  } catch {
    return false;
  }
}

// ── NEP-413 ─────────────────────────────────────────────────────────────────

export const NEP413_TAG = 2 ** 31 + 413;
const borshString = (s) => { const b = utf8(s); return concat(u32le(b.length), b); };

/** The bytes before hashing: u32le(tag) || Borsh(payload). */
export function nep413Preimage({ message, nonce, recipient, callbackUrl }) {
  if (!(nonce instanceof Uint8Array) || nonce.length !== 32) throw new Error('NEP-413: the nonce is 32 bytes');
  return concat(u32le(NEP413_TAG), borshString(message), nonce, borshString(recipient),
    callbackUrl == null ? Uint8Array.of(0) : concat(Uint8Array.of(1), borshString(callbackUrl)));
}
/** The 32 bytes a NEP-413 wallet signs. */
export const nep413Digest = (payload) => sha256(nep413Preimage(payload));

export function parseNearPublicKey(s) {
  if (typeof s !== 'string' || !s.startsWith('ed25519:')) throw new Error('a NEAR public key is "ed25519:" and base58');
  const b = base58Decode(s.slice(8));
  if (b.length !== 32) throw new Error('a NEAR public key is 32 bytes');
  return b;
}
export const nearPublicKeyText = (pk) => `ed25519:${base58Encode(pk)}`;

/** A NEAR signature as wallets return it: base64 (NEP-413), 128 hex digits,
 *  or "ed25519:" and base58. */
export function parseNearSignature(s) {
  if (s instanceof Uint8Array) return s.length === 64 ? new Uint8Array(s) : (() => { throw new Error('a NEAR signature is 64 bytes'); })();
  if (typeof s !== 'string') throw new Error('the wallet returned no signature');
  let b;
  if (s.startsWith('ed25519:')) b = base58Decode(s.slice(8));
  else if (/^[0-9a-fA-F]{128}$/.test(s)) b = fromHex(s);
  else b = base64Decode(s);
  if (b.length !== 64) throw new Error(`a NEAR signature is 64 bytes, got ${b.length}`);
  return b;
}

// ── CBOR (RFC 8949): the subset COSE needs ─────────────────────────────────

export class CborMap {
  constructor(entries) { this.entries = entries; }
  get(k) { const e = this.entries.find(([key]) => key === k); return e ? e[1] : undefined; }
  keys() { return this.entries.map(([k]) => k); }
}
export class CborTag { constructor(tag, value) { this.tag = tag; this.value = value; } }

/** Strict decoder: one item, all input consumed, no indefinite lengths, no
 *  duplicate map keys, no floats. */
export function cborDecode(bytes) {
  let i = 0;
  const need = (n) => { if (i + n > bytes.length) throw new Error('cbor: truncated'); };
  const head = () => {
    need(1);
    const b = bytes[i++];
    const major = b >> 5, ai = b & 31;
    let arg;
    if (ai < 24) arg = BigInt(ai);
    else if (ai <= 27) {
      const n = 1 << (ai - 24);
      need(n);
      arg = 0n;
      for (let k = 0; k < n; k++) arg = (arg << 8n) | BigInt(bytes[i++]);
    } else throw new Error(`cbor: additional information ${ai} is not accepted`);
    return { major, ai, arg };
  };
  const small = (v) => {
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor: integer too large');
    return Number(v);
  };
  const item = () => {
    const { major, ai, arg } = head();
    switch (major) {
      case 0: return small(arg);
      case 1: return -1 - small(arg);
      case 2: case 3: {
        const n = small(arg);
        need(n);
        const out = bytes.slice(i, i + n);
        i += n;
        return major === 2 ? out : fromUtf8(out);
      }
      case 4: { const a = []; for (let k = 0, n = small(arg); k < n; k++) a.push(item()); return a; }
      case 5: {
        const e = [];
        const seen = new Set();
        for (let k = 0, n = small(arg); k < n; k++) {
          const key = item();
          const id = key instanceof Uint8Array ? `b:${toHex(key)}` : `${typeof key}:${String(key)}`;
          if (seen.has(id)) throw new Error('cbor: duplicate map key');
          seen.add(id);
          e.push([key, item()]);
        }
        return new CborMap(e);
      }
      case 6: return new CborTag(small(arg), item());
      case 7:
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        throw new Error('cbor: simple value or float not accepted');
      default: throw new Error('cbor: unreachable');
    }
  };
  const v = item();
  if (i !== bytes.length) throw new Error(`cbor: ${bytes.length - i} trailing bytes`);
  return v;
}

function cborHead(major, n) {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  if (n < 0x100000000) return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  throw new Error('cbor: length too large');
}
/** Minimal-head encoder for integers, bytes, text, arrays, CborMap (in its
 *  own key order) and the booleans. */
export function cborEncode(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('cbor: only integers');
    return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  }
  if (v instanceof Uint8Array) return concat(cborHead(2, v.length), v);
  if (typeof v === 'string') { const b = utf8(v); return concat(cborHead(3, b.length), b); }
  if (Array.isArray(v)) return concat(cborHead(4, v.length), ...v.map(cborEncode));
  if (v instanceof CborMap) return concat(cborHead(5, v.entries.length), ...v.entries.flatMap(([k, x]) => [cborEncode(k), cborEncode(x)]));
  if (v instanceof CborTag) return concat(cborHead(6, v.tag), cborEncode(v.value));
  if (v === false) return Uint8Array.of(0xf4);
  if (v === true) return Uint8Array.of(0xf5);
  if (v === null) return Uint8Array.of(0xf6);
  throw new Error(`cbor: cannot encode ${typeof v}`);
}

// ── CIP-8 / COSE ────────────────────────────────────────────────────────────

/** The protected-header layouts the Cardano arm accepts, as exact bytes:
 *  layout 1 {1: -8, "address": addr} (Eternl, Trezor, Ledger), layout 2
 *  {1: -8, 4: addr, "address": addr} (Lace). */
export const CIP8_LAYOUTS = Object.freeze({
  1: (addr) => cborEncode(new CborMap([[1, -8], ['address', addr]])),
  2: (addr) => cborEncode(new CborMap([[1, -8], [4, addr], ['address', addr]])),
});

/** Which accepted layout the protected header is, for the given address,
 *  or null. */
export function cip8Layout(protectedBytes, addr) {
  for (const [n, build] of Object.entries(CIP8_LAYOUTS)) if (equalBytes(protectedBytes, build(addr))) return Number(n);
  return null;
}

/** COSE_Sign1 from CIP-30 signData's `signature` (hex), tagged (18) or not. */
export function parseCoseSign1(hex) {
  let v = cborDecode(fromHex(hex));
  if (v instanceof CborTag) {
    if (v.tag !== 18) throw new Error(`COSE_Sign1: tag ${v.tag}, not 18`);
    v = v.value;
  }
  if (!Array.isArray(v) || v.length !== 4) throw new Error('COSE_Sign1: not an array of four');
  const [protectedBytes, unprotected, payload, signature] = v;
  if (!(protectedBytes instanceof Uint8Array)) throw new Error('COSE_Sign1: the protected header is not a byte string');
  if (!(unprotected instanceof CborMap)) throw new Error('COSE_Sign1: the unprotected header is not a map');
  if (!(payload instanceof Uint8Array)) throw new Error('COSE_Sign1: the payload is detached or not bytes');
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error('COSE_Sign1: the signature is not 64 bytes');
  const hashed = unprotected.get('hashed');
  return { protectedBytes, hashed: hashed === true, hashedValue: hashed, payload, signature };
}

/** The 32-byte Ed25519 key of a CIP-30 COSE_Key (hex): kty OKP, crv Ed25519. */
export function parseCoseKey(hex) {
  const m = cborDecode(fromHex(hex));
  if (!(m instanceof CborMap)) throw new Error('COSE_Key: not a map');
  if (m.get(1) !== 1) throw new Error('COSE_Key: kty is not OKP (1)');
  const alg = m.get(3);
  if (alg !== undefined && alg !== -8) throw new Error('COSE_Key: alg is not EdDSA (-8)');
  if (m.get(-1) !== 6) throw new Error('COSE_Key: crv is not Ed25519 (6)');
  const x = m.get(-2);
  if (!(x instanceof Uint8Array) || x.length !== 32) throw new Error('COSE_Key: x is not 32 bytes');
  return x;
}

/** Sig_structure bytes with an empty external_aad. */
export const cip8SigStructure = (protectedBytes, payload) => cborEncode(['Signature1', protectedBytes, new Uint8Array(0), payload]);

/** A Cardano reward address: 29 bytes, header 0xe0 (testnet) or 0xe1
 *  (mainnet), a stake-key credential. */
export function isRewardAddress(addr) {
  return addr instanceof Uint8Array && addr.length === 29 && (addr[0] === 0xe0 || addr[0] === 0xe1);
}
