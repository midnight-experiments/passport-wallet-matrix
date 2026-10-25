// A small element builder. Text is always set as text nodes, never parsed as
// HTML, so wallet-supplied names and reasons cannot inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, ...children);
  return el;
}

/** Appends children, skipping null, undefined and false (DOM append would
 *  write them as text), and flattening arrays. */
export function append(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** A link that opens outside the page, with no referrer. Only https links
 *  are made clickable. */
export function extLink(url, text) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return h('span', {}, text ?? url ?? '');
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text ?? url);
}

/** Saves text as a file in the visitor's browser (nothing is uploaded). */
export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
