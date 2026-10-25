// A software Solana wallet as a Wallet Standard wallet, over a public test
// seed. Options:
//   name        the name it registers (Phantom, Backpack, Solflare, or any other)
//   offchain    offers solana:signOffchainMessage with these message versions
//   raw         offers solana:signMessage (default true)
//   mode        deterministic | hedged | refuse-raw | no-head | other-key | v0 | wrong-envelope
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Encode, utf8, concat } from '../../src/bytes.js';
import { testSeed, hedgedEd25519Sign } from './keys.mjs';

export const solKey = (label) => ed25519.getPublicKey(testSeed(label));

export function solWallet({ name = 'Test Solana', label = 'sol one', otherLabel = 'sol other', offchain = [1], raw = true, mode = 'deterministic', version = '1.0.0' } = {}) {
  const seed = testSeed(label);
  const otherSeed = testSeed(otherLabel);
  const publicKey = ed25519.getPublicKey(seed);
  const account = { address: base58Encode(publicKey), publicKey, chains: ['solana:devnet'], features: ['solana:signMessage'] };
  const calls = [];
  const signBytes = (bytes) => {
    if (mode === 'hedged') return hedgedEd25519Sign(bytes, seed);
    return ed25519.sign(bytes, mode === 'other-key' ? otherSeed : seed);
  };
  const features = {
    'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
  };
  if (raw) {
    features['solana:signMessage'] = {
      version: '1.0.0',
      signMessage: async (...inputs) => inputs.map(({ message }) => {
        calls.push('signMessage');
        if (mode === 'refuse-raw') throw Object.assign(new Error('raw messages are not supported'), { code: 4001 });
        const m = new Uint8Array(message);
        const signed = mode === 'no-head' ? m.subarray(50) : m;
        return { signedMessage: m, signature: signBytes(signed) };
      }),
    };
  }
  if (offchain) {
    features['solana:signOffchainMessage'] = {
      version: '1.0.0',
      supportedMessageVersions: offchain,
      signOffchainMessage: async (...inputs) => inputs.map(({ message, requiredSigners, messageVersion }) => {
        calls.push('signOffchainMessage');
        const text = utf8(message);
        const env = mode === 'v0'
          ? concat(Uint8Array.of(0xff), utf8('solana offchain'), Uint8Array.of(0), new Uint8Array(32), Uint8Array.of(0, 1), publicKey, Uint8Array.of(text.length & 0xff, text.length >> 8), text)
          : concat(Uint8Array.of(0xff), utf8('solana offchain'), Uint8Array.of(messageVersion, requiredSigners.length), ...requiredSigners, text);
        return { signedOffchainMessage: mode === 'wrong-envelope' ? env.subarray(1) : env, signature: signBytes(env) };
      }),
    };
  }
  return { version, name, icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], accounts: [account], features, calls, publicKey };
}
