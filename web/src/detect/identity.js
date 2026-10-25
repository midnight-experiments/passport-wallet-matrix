// Which object a wallet answers through. A wallet names itself, and any
// extension can name itself anything, so the page identifies each provider
// object by its own identity in this page (#1, #2, ...): two announcements
// that hand over the same object are one extension answering under two
// names, whatever the names say.

export class ObjectIds {
  constructor() {
    this.ids = new WeakMap();
    this.next = 1;
  }

  /** This page's id for an object, the same every time it is seen. */
  id(obj) {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return null;
    let v = this.ids.get(obj);
    if (!v) {
      v = `#${this.next++}`;
      this.ids.set(obj, v);
    }
    return v;
  }
}

/** Reads a property without letting a hostile getter or proxy throw. */
export function safeGet(obj, key) {
  try { return obj?.[key]; } catch { return undefined; }
}

/** A short visible string from wallet-supplied text. */
export function shortText(v, n = 80) {
  if (typeof v !== 'string') return v === undefined || v === null ? null : String(v).slice(0, n);
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
}

/** Groups detected entries by their provider object and records, on each,
 *  the other names the same object answers as, with a warning. */
export function markShared(entries, what) {
  const byObject = new Map();
  for (const e of entries) {
    if (!e.objectId) continue;
    if (!byObject.has(e.objectId)) byObject.set(e.objectId, []);
    byObject.get(e.objectId).push(e);
  }
  for (const group of byObject.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      e.sharedWith = group.filter((x) => x !== e).map((x) => x.name ?? x.key);
      e.warnings.push(`The same ${what} (${e.objectId}) also answers as ${e.sharedWith.join(', ')}: one extension answers under several names, so its name says nothing about which software signs.`);
    }
  }
  return entries;
}
