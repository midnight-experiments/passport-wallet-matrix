// Test keys: every one is SHA-256 of a public label, so anyone can derive
// them and none ever held funds. Real wallets' keys never appear in tests.
import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

export const testSeed = (label) => sha256(new TextEncoder().encode(`passport-wallet-matrix public test key: ${label}`));

export function testSecp256k1(label) {
  const sk = testSeed(label);
  const n = secp256k1.Point.Fn.ORDER;
  let v = 0n; for (const b of sk) v = (v << 8n) | BigInt(b);
  if (v === 0n || v >= n) throw new Error('test key out of range');
  return sk;
}

const L = ed25519.Point.Fn.ORDER;
const leInt = (b) => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; };
const le32 = (v) => { const o = new Uint8Array(32); let x = v; for (let i = 0; i < 32; i++) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };

/** An Ed25519 signature whose nonce is random instead of RFC 8032's
 *  deterministic one: valid under the key, different every time. It stands
 *  in for a hedged or MPC signer. */
export function hedgedEd25519Sign(message, seed) {
  const h = sha512(seed);
  const a = h.slice(0, 32); a[0] &= 248; a[31] &= 127; a[31] |= 64;
  const s = leInt(a) % L;
  const A = ed25519.Point.BASE.multiply(s).toBytes();
  const rnd = new Uint8Array(64); globalThis.crypto.getRandomValues(rnd);
  const r = (leInt(sha512(new Uint8Array([...rnd, ...message]))) % (L - 1n)) + 1n;
  const R = ed25519.Point.BASE.multiply(r).toBytes();
  const k = leInt(sha512(new Uint8Array([...R, ...A, ...message]))) % L;
  const S = (r + k * s) % L;
  return new Uint8Array([...R, ...le32(S)]);
}
