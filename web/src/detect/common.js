// The detected-wallet record every detector returns.

/** A detected wallet. `object` (the provider, wallet or CIP-30 entry the page
 *  would talk to) is not enumerable, so it never reaches an exported file. */
export function detectedEntry(fields, object) {
  const e = {
    key: fields.key,
    family: fields.family,
    standard: fields.standard,
    name: fields.name ?? null,
    productId: null,
    productBy: null,
    objectId: null,
    sharedWith: [],
    flags: [],
    warnings: [],
    notes: [],
    ...fields,
  };
  Object.defineProperty(e, 'object', { value: object, enumerable: false, writable: true });
  return e;
}

/** What a result records about the wallet it tested: the detection facts,
 *  never the live object. */
export function describeDetected(e) {
  if (!e) return null;
  const out = {};
  for (const k of ['key', 'family', 'standard', 'name', 'rdns', 'uuid', 'cip30Key', 'moduleId', 'version', 'apiVersion', 'objectId', 'sharedWith', 'flags', 'productId', 'productBy', 'warnings', 'notes', 'chains', 'features', 'available', 'moduleType']) {
    if (e[k] !== undefined && e[k] !== null && !(Array.isArray(e[k]) && e[k].length === 0)) out[k] = JSON.parse(JSON.stringify(e[k]));
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
