// Solana wallets: the Wallet Standard's registration protocol, as an app.
// The page listens for `wallet-standard:register-wallet` from the moment it
// loads and announces itself with `wallet-standard:app-ready`, so wallets
// that loaded before and after the page both register. A wallet is kept when
// it offers a Solana chain or a Solana signing feature.

import { detectedEntry } from './common.js';
import { ObjectIds, markShared, safeGet, shortText } from './identity.js';
import { productByName } from './names.js';
import { supportedMessageVersions, solFormatsOf } from '../probe/solana.js';
import { base58Encode } from '../bytes.js';

export class WalletStandardListener {
  constructor(win) {
    this.win = win;
    this.wallets = new Set();
    const register = (...wallets) => {
      for (const w of wallets) if (w && typeof w === 'object') this.wallets.add(w);
      return () => { for (const w of wallets) this.wallets.delete(w); };
    };
    this.api = Object.freeze({ register });
    this.onRegister = (ev) => {
      const cb = safeGet(ev, 'detail');
      if (typeof cb === 'function') { try { cb(this.api); } catch { /* a wallet's own error */ } }
    };
    win.addEventListener('wallet-standard:register-wallet', this.onRegister);
    try {
      win.dispatchEvent(new globalThis.CustomEvent('wallet-standard:app-ready', { detail: this.api }));
    } catch { /* no events */ }
  }

  stop() { this.win.removeEventListener('wallet-standard:register-wallet', this.onRegister); }
}

const isSolana = (w) => {
  const chains = safeGet(w, 'chains');
  const features = safeGet(w, 'features') ?? {};
  return (Array.isArray(chains) && chains.some((c) => String(c).startsWith('solana:')))
    || Object.keys(features).some((f) => f.startsWith('solana:sign'));
};

/** The detected Solana wallets among the registered ones. */
export function solanaDetected(wallets, ids = new ObjectIds()) {
  const entries = [];
  let n = 0;
  for (const w of wallets) {
    if (!isSolana(w)) continue;
    n++;
    const name = shortText(safeGet(w, 'name'));
    const features = safeGet(w, 'features') ?? {};
    const e = detectedEntry({ key: `solana:ws:${n}:${String(name ?? '').toLowerCase()}`, family: 'solana', standard: 'Wallet Standard', name, version: shortText(safeGet(w, 'version'), 20) }, w);
    e.objectId = ids.id(w);
    e.productId = productByName(name);
    e.productBy = e.productId ? 'name' : null;
    e.chains = (safeGet(w, 'chains') ?? []).filter((c) => String(c).startsWith('solana:')).map(String).slice(0, 8);
    e.features = Object.keys(features).filter((f) => f.startsWith('solana:') || f.startsWith('standard:')).sort();
    e.supportedMessageVersions = supportedMessageVersions(features);
    e.formats = solFormatsOf(w);
    const accounts = safeGet(w, 'accounts');
    e.accountKeys = Array.isArray(accounts) ? accounts.map((a) => { try { return base58Encode(Uint8Array.from(a.publicKey)); } catch { return null; } }).filter(Boolean).slice(0, 8) : [];
    entries.push(e);
  }
  markShared(entries, 'wallet object');
  const byName = new Map();
  for (const e of entries) {
    const k = String(e.name ?? '').toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(e);
  }
  for (const [name, group] of byName) {
    if (group.length > 1) for (const e of group) e.warnings.push(`${group.length} different wallets register the name "${name}": at least one of them is not the wallet it names.`);
  }
  for (const e of entries) {
    for (const k of e.accountKeys) {
      const others = entries.filter((x) => x !== e && x.accountKeys.includes(k)).map((x) => x.name);
      if (others.length) e.notes.push(`Its account ${k.slice(0, 8)}… is also offered by ${others.join(', ')} (one seed in two wallets, or one wallet answering for another).`);
    }
  }
  return entries;
}
