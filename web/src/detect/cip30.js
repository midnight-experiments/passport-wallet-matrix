// Cardano wallets: the CIP-30 entries under window.cardano. Each entry is
// identified by this page's object id; a wallet that places one object under
// several keys (some can stand in for other wallets) is flagged, and the key
// and the name it reports are both shown as the wallet's own report.

import { detectedEntry } from './common.js';
import { ObjectIds, markShared, safeGet, shortText } from './identity.js';
import { CIP30_KEYS, productByName } from './names.js';

export function cardanoDetected(cardano, ids = new ObjectIds()) {
  const entries = [];
  if (!cardano || typeof cardano !== 'object') return entries;
  let keys;
  try { keys = Object.keys(cardano); } catch { return entries; }
  for (const key of keys.slice(0, 40)) {
    const w = safeGet(cardano, key);
    if (!w || typeof w !== 'object' || typeof safeGet(w, 'enable') !== 'function') continue;
    const name = shortText(safeGet(w, 'name'));
    const e = detectedEntry({ key: `cardano:cip30:${shortText(key, 40)}`, family: 'cardano', standard: 'CIP-30', name: name ?? key, cip30Key: shortText(key, 40), apiVersion: shortText(safeGet(w, 'apiVersion'), 20) }, w);
    e.objectId = ids.id(w);
    const byKey = CIP30_KEYS[String(key).toLowerCase()] ?? null;
    const byName = productByName(name);
    e.productId = byKey ?? byName;
    e.productBy = byKey ? 'key' : byName ? 'name' : null;
    if (byKey && byName && byKey !== byName) e.warnings.push(`It sits under window.cardano.${key} but names itself ${name}, another wallet.`);
    entries.push(e);
  }
  return markShared(entries, 'CIP-30 object');
}
