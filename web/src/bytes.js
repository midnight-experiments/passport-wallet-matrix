// Byte helpers shared by the probes, the export and the hardware paths.

export const utf8 = (s) => new TextEncoder().encode(s);
export const fromUtf8 = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);

export function toHex(b) {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Hex without or with a 0x prefix, either case; refuses anything else. */
export function fromHex(h) {
  if (typeof h !== 'string') throw new Error('not a hex string');
  const s = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error(`not a hex string: ${h.slice(0, 24)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const equalBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);

export function u32le(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('u32 out of range');
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

export function u64le(v) {
  let x = BigInt(v);
  if (x < 0n || x > 0xffffffffffffffffn) throw new Error('u64 out of range');
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(b) {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  let s = '';
  while (v > 0n) { s = B58[Number(v % 58n)] + s; v /= 58n; }
  for (const x of b) { if (x === 0) s = '1' + s; else break; }
  return s;
}
export function base58Decode(s) {
  if (typeof s !== 'string' || s.length === 0) throw new Error('not base58');
  let v = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('not base58');
    v = v * 58n + BigInt(i);
  }
  const out = [];
  while (v > 0n) { out.unshift(Number(v & 0xffn)); v >>= 8n; }
  for (const c of s) { if (c === '1') out.unshift(0); else break; }
  return Uint8Array.from(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Encode(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
/** Standard or URL-safe base64, padded or not. */
export function base64Decode(s) {
  if (typeof s !== 'string') throw new Error('not base64');
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) throw new Error('not base64');
  const out = [];
  let acc = 0, bits = 0;
  for (const c of t) {
    acc = (acc << 6) | B64.indexOf(c); bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

/** Fresh random bytes from the platform's CSPRNG. */
export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
