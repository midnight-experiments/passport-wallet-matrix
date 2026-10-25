// The part of Node's `util` module that browser dependencies call:
// `format` with %s, %d, %j and %%, `inspect`, `inherits` and the text codecs.
export function format(f, ...args) {
  let i = 0;
  const s = String(f).replace(/%[sdj%]/g, (m) => {
    if (m === '%%') return '%';
    if (i >= args.length) return m;
    const a = args[i++];
    return m === '%d' ? String(Number(a)) : m === '%j' ? JSON.stringify(a) : String(a);
  });
  return [s, ...args.slice(i).map(String)].join(' ');
}
export const inspect = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };
export function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  Object.setPrototypeOf(ctor, superCtor);
}
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;
export const deprecate = (fn) => fn;
export const debuglog = () => () => {};
export default { format, inspect, inherits, TextEncoder, TextDecoder, deprecate, debuglog };
