// A software NEAR wallet: the selector's signMessage over a public test seed.
// mode: deterministic | hedged | callback | other-key | refuse
import { ed25519 } from '@noble/curves/ed25519.js';
import { nep413Digest, nearPublicKeyText } from '../../src/probe/envelopes.js';
import { base64Encode } from '../../src/bytes.js';
import { testSeed, hedgedEd25519Sign } from './keys.mjs';

export function nearWallet({ label = 'near one', otherLabel = 'near other', mode = 'deterministic', callbackUrl = 'https://passport-wallet-matrix.test/#/test' } = {}) {
  const seed = testSeed(label);
  const other = testSeed(otherLabel);
  const pk = ed25519.getPublicKey(seed);
  let n = 0;
  return {
    publicKey: pk,
    async connect() { return { accountId: 'probe.testnet' }; },
    async signMessage({ message, recipient, nonce }) {
      n++;
      if (mode === 'refuse') throw new Error('User rejected');
      const digest = nep413Digest({ message, recipient, nonce, callbackUrl: mode === 'callback' ? callbackUrl : null });
      const useOther = mode === 'other-key' && n > 1;
      const s = useOther ? other : seed;
      const sig = mode === 'hedged' ? hedgedEd25519Sign(digest, seed) : ed25519.sign(digest, s);
      return { accountId: 'probe.testnet', publicKey: nearPublicKeyText(useOther ? ed25519.getPublicKey(other) : pk), signature: base64Encode(sig) };
    },
  };
}
