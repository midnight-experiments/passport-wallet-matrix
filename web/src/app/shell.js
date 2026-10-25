// The page shell: the header, the stagenet notice, one tab per section and
// hash routing (#/<section id>).
//
// A section is a module `src/sections/<name>/section.js` whose default
// export is { id, title, order, mount(container, ctx) } (mount may be async
// and runs once, the first time the section is shown) with an optional
// onShow(ctx). The bundler finds every section folder (esbuild-config.mjs),
// so a later phase adds a page by adding a folder; no file here lists them.

import { h, clear, append } from './dom.js';

export function startShell(root, sections, ctx) {
  const ordered = [...sections].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || String(a.id).localeCompare(String(b.id)));
  const ids = new Set();
  for (const s of ordered) {
    if (!s?.id || typeof s.mount !== 'function') throw new Error('a section needs an id and a mount function');
    if (ids.has(s.id)) throw new Error(`two sections use the id ${s.id}`);
    ids.add(s.id);
  }
  const mounted = new Map();
  const tabs = new Map();
  const panes = new Map();

  const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
  const main = h('main', { id: 'main' });
  for (const s of ordered) {
    const tab = h('a', { href: `#/${s.id}`, class: 'tab', id: `tab-${s.id}`, 'aria-controls': `pane-${s.id}` }, s.title);
    tabs.set(s.id, tab);
    nav.append(tab);
    const pane = h('section', { id: `pane-${s.id}`, class: 'pane', 'aria-labelledby': `tab-${s.id}`, hidden: true });
    panes.set(s.id, pane);
    main.append(pane);
  }

  clear(root);
  append(root, 
    h('header', { class: 'site' },
      h('div', { class: 'brand' },
        h('h1', {}, 'Passport wallet matrix'),
        h('p', { class: 'tagline' }, 'Which wallets can control a Midnight Passport account, and how well: software and hardware, EVM, Solana, NEAR and Cardano.')),
      h('p', { class: 'notice', role: 'note' },
        h('strong', {}, 'Stagenet test page. '),
        'Nothing here holds real funds, and nothing you do here is sent to a server. Never type a seed phrase, password or private key into this page: wallets sign in their own windows.')),
    nav,
    main,
    h('footer', { class: 'site' },
      h('p', {}, `Curated data version ${ctx.model.data.version}, updated ${ctx.model.data.updated}. `,
        h('a', { href: 'https://github.com/midnight-experiments/passport-wallet-matrix', target: '_blank', rel: 'noopener noreferrer' }, 'Source and data'),
        '. Apache-2.0.')),
  );

  const show = async (id) => {
    const s = ordered.find((x) => x.id === id) ?? ordered[0];
    for (const [sid, pane] of panes) {
      pane.hidden = sid !== s.id;
      tabs.get(sid).setAttribute('aria-current', sid === s.id ? 'page' : 'false');
    }
    if (!mounted.has(s.id)) {
      const pane = panes.get(s.id);
      mounted.set(s.id, Promise.resolve().then(() => s.mount(pane, ctx)).catch((e) => {
        pane.append(h('p', { class: 'error', role: 'alert' }, `This section failed to load: ${e?.message ?? e}`));
      }));
    }
    await mounted.get(s.id);
    try { s.onShow?.(ctx); } catch { /* a section's own display */ }
  };

  const route = () => {
    const m = /^#\/([a-z0-9-]+)/.exec(location.hash);
    return show(m ? m[1] : ordered[0].id);
  };
  ctx.go = (id) => { if (location.hash !== `#/${id}`) location.hash = `#/${id}`; else route(); };
  window.addEventListener('hashchange', route);
  return route();
}
