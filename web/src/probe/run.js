// Runs "test my wallet" on a detected wallet: picks the family's adapter for
// the standard it was found through, runs the family's test and builds the
// result, compared with the curated row of the name the wallet reports.

import { describeDetected } from '../detect/common.js';
import { loadNearSelector } from '../detect/near.js';
import { testEvm, eip1193Adapter, quietAccounts } from './evm.js';
import { testSolana } from './solana.js';
import { testNear } from './near.js';
import { testCardano } from './cardano.js';
import { makeResult } from './result.js';
import { Buffer } from 'buffer';

/** The curated row a detected wallet's own report points to, or null. */
export function baselineFor(model, d) {
  return d?.productId ? model.views.get(`${d.productId}--${d.family}`) ?? null : null;
}

const browserName = () => {
  try { return String(globalThis.navigator?.userAgent ?? '').slice(0, 200) || null; } catch { return null; }
};

/** The surface a result records: what the wallet reports and what the
 *  visitor typed, never more. */
export function surfaceOf(d, version) {
  return {
    product: d?.name ?? null,
    ...(version ? { version: String(version).slice(0, 60) } : {}),
    ...(browserName() ? { browser: browserName() } : {}),
    access: d?.standard ?? null,
  };
}

/** The family test for a detected wallet. `ctx` needs the detector. */
export async function runFamilyTest(d, ctx) {
  const detector = ctx.detector;
  switch (d.family) {
    case 'evm': {
      const others = async () => {
        const out = [];
        for (const e of detector.snapshot()) if (e.family === 'evm' && e.key !== d.key && e.object) out.push(...await quietAccounts(e.object));
        return out;
      };
      return testEvm(eip1193Adapter(d.object, { others }));
    }
    case 'solana':
      return testSolana({ kind: 'standard', wallet: d.object }, { others: () => detector.solanaKeysExcept(d) });
    case 'near': {
      const selector = await loadNearSelector();
      const wallet = await selector.wallet(d.moduleId);
      return testNear({
        async connect() {
          let accounts = [];
          try { accounts = (await wallet.getAccounts?.()) ?? []; } catch { accounts = []; }
          return { accountId: accounts[0]?.accountId ?? null };
        },
        // The selector accepts the nonce only as a Buffer.
        signMessage: ({ message, recipient, nonce }) => wallet.signMessage({ message, recipient, nonce: Buffer.from(nonce) }),
      }, { pageUrl: String(globalThis.location?.href ?? '') || null });
    }
    case 'cardano':
      return testCardano(null, { enable: () => d.object.enable() });
    default:
      throw new Error(`unknown family ${d.family}`);
  }
}

/** Runs the test and returns the result. */
export async function runDetectedTest(d, ctx, { version = null } = {}) {
  const test = await runFamilyTest(d, ctx);
  return makeResult({
    family: d.family,
    test,
    wallet: { standard: d.standard, reported: describeDetected(d), surface: surfaceOf(d, version) },
    baselineView: baselineFor(ctx.model, d),
    page: ctx.page,
  });
}

/** What the test will ask a wallet of this family, in order. */
export const PROMPTS = Object.freeze({
  evm: [
    'Connect (eth_requestAccounts).',
    'Sign a Passport approval as EIP-712 V1 typed data, twice: a rotate_enc_key approval for a random account that does not exist, setting the all-zero value (no key) as its new key.',
    'Sign the privacy-key request with personal_sign, twice, for the probe network "wallet-matrix-probe", where no account lives.',
  ],
  solana: [
    'Connect (standard:connect).',
    'Sign a format-check text that authorises nothing: raw first, then the off-chain message v1 if the wallet advertises it (a wallet the client knows by name is asked only in the format its rule gives).',
    'Sign the privacy-key request for the probe network, twice, in the format that passed.',
  ],
  near: [
    'Connect through the NEAR wallet selector.',
    'Sign an approval-form NEP-413 check text for a probe account that does not exist (callbackUrl absent).',
    'Sign the privacy-key request for the probe network, twice.',
  ],
  cardano: [
    'Connect (CIP-30 enable) and read the reward address.',
    'Sign a check text through the reward address (this shows the wallet\'s header layout); a layout-1 wallet then signs it again with the fixed 32-byte prefix.',
    'Sign the privacy-key request for the probe network, twice.',
  ],
});

