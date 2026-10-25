// EVM wallets: EIP-6963 announcements, and the legacy window.ethereum when
// no announcement hands over that object.
//
// The page listens from the moment it loads (wallets announce once, when
// asked) and asks with eip6963:requestProvider. Each announcement's provider
// object is identified by this page's object id; the name, uuid and rdns are
// the wallet's own report.

import { detectedEntry } from './common.js';
import { ObjectIds, markShared, safeGet, shortText } from './identity.js';
import { EVM_FLAGS, productByName, productByRdns } from './names.js';

export class Eip6963Listener {
  constructor(win) {
    this.win = win;
    this.announcements = new Map();
    this.onAnnounce = (ev) => {
      const d = safeGet(ev, 'detail');
      const info = safeGet(d, 'info');
      const provider = safeGet(d, 'provider');
      const uuid = shortText(safeGet(info, 'uuid'), 64);
      if (!uuid || !provider || typeof safeGet(provider, 'request') !== 'function') return;
      if (this.announcements.has(uuid)) return;
      const icon = safeGet(info, 'icon');
      this.announcements.set(uuid, {
        info: { uuid, name: shortText(safeGet(info, 'name')), rdns: shortText(safeGet(info, 'rdns'), 120), hasIcon: typeof icon === 'string' && icon.startsWith('data:image/') },
        provider,
      });
    };
    win.addEventListener('eip6963:announceProvider', this.onAnnounce);
  }

  request() {
    try { this.win.dispatchEvent(new globalThis.Event('eip6963:requestProvider')); } catch { /* no events */ }
  }

  stop() { this.win.removeEventListener('eip6963:announceProvider', this.onAnnounce); }
}

/** The flags an EIP-1193 object sets, read without trusting it. */
export function providerFlags(provider) {
  const out = [];
  for (const flag of Object.keys(EVM_FLAGS)) if (safeGet(provider, flag) === true) out.push(flag);
  return out;
}

/** The detected EVM wallets from the announcements seen and window.ethereum. */
export function evmDetected(announcements, windowEthereum, ids = new ObjectIds()) {
  const entries = [];
  for (const { info, provider } of announcements) {
    const e = detectedEntry({
      key: `evm:eip6963:${info.uuid}`, family: 'evm', standard: 'EIP-6963', name: info.name, rdns: info.rdns, uuid: info.uuid,
    }, provider);
    e.objectId = ids.id(provider);
    e.flags = providerFlags(provider);
    const byRdns = productByRdns(info.rdns), byName = productByName(info.name);
    e.productId = byRdns ?? byName;
    e.productBy = byRdns ? 'rdns' : byName ? 'name' : null;
    if (byRdns && byName && byRdns !== byName) e.warnings.push(`It names itself ${info.name} but announces the rdns ${info.rdns}, which belongs to another wallet.`);
    if (windowEthereum && provider === windowEthereum) e.notes.push('Its provider object is also window.ethereum.');
    const claims = [...new Set(e.flags.map((f) => EVM_FLAGS[f]).filter((p) => p && p !== e.productId))];
    if (claims.length) e.notes.push(`Its provider also sets ${e.flags.filter((f) => claims.includes(EVM_FLAGS[f])).join(', ')}, which other wallets set too (often for compatibility).`);
    entries.push(e);
  }
  markShared(entries, 'provider object');
  if (windowEthereum && typeof safeGet(windowEthereum, 'request') === 'function' && !announcements.some((a) => a.provider === windowEthereum)) {
    const flags = providerFlags(windowEthereum);
    const products = [...new Set(flags.map((f) => EVM_FLAGS[f]).filter(Boolean))];
    const e = detectedEntry({
      key: 'evm:window.ethereum', family: 'evm', standard: 'window.ethereum (no EIP-6963 announcement)',
      name: flags.length ? `window.ethereum (${flags.join(', ')})` : 'window.ethereum',
    }, windowEthereum);
    e.objectId = ids.id(windowEthereum);
    e.flags = flags;
    if (products.length === 1) { e.productId = products[0]; e.productBy = 'flag'; }
    if (products.length > 1) e.warnings.push(`Its flags claim several wallets (${flags.join(', ')}): which one answers cannot be told from the object.`);
    entries.push(e);
  }
  return entries;
}
