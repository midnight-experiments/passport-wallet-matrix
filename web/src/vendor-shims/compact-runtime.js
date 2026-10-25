// The two Curve25519 helpers the vendored Solana arm imports from
// @midnight-ntwrk/compact-runtime, with the behaviour of its 0.20.0 release.
// The full runtime bundles the on-chain WebAssembly, which the wallet table
// never runs; these two functions need only the curve arithmetic.

import { ed25519 } from '@noble/curves/ed25519.js';

const CURVE25519_BASE_MODULUS = 2n ** 255n - 19n;

/** A valid Curve25519Point: bigint coordinates in the base field, on the
 *  curve and in the prime-order subgroup; the identity is the affine (0, 1). */
export function isValidCurve25519Point(p) {
  if (typeof p !== 'object' || p === null) return false;
  const { x, y } = p;
  if (typeof x !== 'bigint' || typeof y !== 'bigint') return false;
  if (x < 0n || x >= CURVE25519_BASE_MODULUS || y < 0n || y >= CURVE25519_BASE_MODULUS) return false;
  if (x !== 0n || y !== 1n) {
    try {
      const pt = ed25519.Point.fromAffine({ x, y });
      pt.assertValidity();
      if (!pt.isTorsionFree()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** A noble projective point as the affine { x, y } a Curve25519Point holds. */
export function curve25519FromProjective(p) {
  const { x, y } = p.toAffine();
  return { x, y };
}
