// A software CIP-30 wallet over a public test seed: signData through the
// reward address as COSE_Sign1. Options:
//   layout  1 ({1:-8, "address"}) or 2 ({1:-8, 4: addr, "address"})
//   mode    deterministic | hedged | hashed | other-address | other-key | refuse
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { cborEncode, CborMap, CIP8_LAYOUTS, cip8SigStructure } from '../../src/probe/envelopes.js';
import { toHex, fromHex, concat } from '../../src/bytes.js';
import { testSeed, hedgedEd25519Sign } from './keys.mjs';

export function cip30Wallet({ name = 'eternl', label = 'ada one', otherLabel = 'ada other', layout = 1, mode = 'deterministic', network = 0 } = {}) {
  const seed = testSeed(label);
  const pk = ed25519.getPublicKey(seed);
  const otherSeed = testSeed(otherLabel);
  // A reward address: header e0 (testnet) and a 28-byte credential; the arm
  // cannot bind it to the key, so any 28 bytes stand in for the hash.
  const reward = concat(Uint8Array.of(0xe0 | network), blake2b(pk, { dkLen: 28 }));
  const payment = concat(Uint8Array.of(0x00 | network), blake2b(pk, { dkLen: 28 }), blake2b(pk, { dkLen: 28 }));
  let calls = 0;
  const api = {
    getNetworkId: async () => network,
    getRewardAddresses: async () => [toHex(reward)],
    getUsedAddresses: async () => [toHex(payment)],
    async signData(addrHex, payloadHex) {
      calls++;
      if (mode === 'refuse') throw { code: 3, info: 'user declined to sign' };
      const addr = mode === 'other-address' ? payment : fromHex(addrHex);
      const prot = CIP8_LAYOUTS[layout](addr);
      const msg = fromHex(payloadHex);
      const payload = mode === 'hashed' ? blake2b(msg, { dkLen: 28 }) : msg;
      const toSign = cip8SigStructure(prot, payload);
      const useOther = mode === 'other-key' && calls > 1;
      const sig = mode === 'hedged' ? hedgedEd25519Sign(toSign, seed) : ed25519.sign(toSign, useOther ? otherSeed : seed);
      const unprotected = new CborMap([['hashed', mode === 'hashed']]);
      const key = cborEncode(new CborMap([[1, 1], [3, -8], [-1, 6], [-2, useOther ? ed25519.getPublicKey(otherSeed) : pk]]));
      return { signature: toHex(cborEncode([prot, unprotected, payload, sig])), key: toHex(key) };
    },
  };
  return { name, apiVersion: '0.1.0', icon: 'data:image/svg+xml;base64,PHN2Zy8+', enable: async () => api, isEnabled: async () => true, api, publicKey: pk, reward };
}
