// Detection: every wallet the browser exposes through the four standards.
// Listening starts when the page loads; nothing here prompts the visitor or
// asks a wallet for an account.

import { ObjectIds } from './identity.js';
import { Eip6963Listener, evmDetected } from './eip6963.js';
import { WalletStandardListener, solanaDetected } from './wallet-standard.js';
import { cardanoDetected } from './cip30.js';
import { nearDetected, nearInjectedObjects } from './near.js';
import { safeGet } from './identity.js';
import { sleep } from './common.js';

export class Detector {
  constructor(win) {
    this.win = win;
    this.ids = new ObjectIds();
    this.eip6963 = new Eip6963Listener(win);
    this.walletStandard = new WalletStandardListener(win);
    this.nearModules = null;
  }

  /** Asks EIP-6963 wallets to announce, waits briefly, and returns every
   *  detected wallet of every family. */
  async detect({ waitMs = 400 } = {}) {
    this.eip6963.request();
    await sleep(waitMs);
    return this.snapshot();
  }

  /** The detected wallets as of now. */
  snapshot() {
    const w = this.win;
    return [
      ...evmDetected([...this.eip6963.announcements.values()], safeGet(w, 'ethereum'), this.ids),
      ...solanaDetected([...this.walletStandard.wallets], this.ids),
      ...nearDetected(this.nearModules, nearInjectedObjects(w), this.ids),
      ...cardanoDetected(safeGet(w, 'cardano'), this.ids),
    ];
  }

  /** Other wallets' reported EVM accounts and Solana keys, the candidates a
   *  signer-check refusal may name. */
  solanaKeysExcept(entry) {
    return this.snapshot().filter((e) => e.family === 'solana' && e.key !== entry?.key)
      .flatMap((e) => [...(safeGet(e.object, 'accounts') ?? [])].map((a) => { try { return Uint8Array.from(a.publicKey); } catch { return null; } }))
      .filter((k) => k && k.length === 32);
  }
}
