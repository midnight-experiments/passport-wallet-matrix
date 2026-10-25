// Browser stand-ins for the Node built-ins (crypto, http, https) that some
// NEAR wallet modules name. Their code paths that use them run only in Node
// (a fetch fallback, a local contract-view runtime); in the browser these
// stand-ins are never called, and if one is, it fails loudly.
export class Agent {
  constructor() { this.keepAlive = false; }
}
export function createHash() {
  throw new Error('crypto.createHash is not available in the browser page');
}
export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export default { Agent, createHash, randomBytes };
