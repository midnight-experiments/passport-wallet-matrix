// NEAR wallets: the NEAR wallet selector and its wallet modules. The
// selector is loaded only when the visitor asks for NEAR wallets, because
// some modules contact their wallet's services when set up. Before that, the
// page notes the NEAR objects that extensions inject (no library needed).
//
// A selector module's availability is the module's own check (for an
// injected wallet, whether its extension's object is present); web and
// mobile wallets are always listed as available, because they open in a
// window of their own.

import { detectedEntry } from './common.js';
import { ObjectIds, markShared, safeGet, shortText } from './identity.js';
import { NEAR_MODULES } from './names.js';

/** The objects NEAR extensions inject, where the selector's modules look. */
export function nearInjectedObjects(win) {
  const out = [];
  const add = (path, obj, moduleId) => { if (obj && typeof obj === 'object') out.push({ path, obj, moduleId }); };
  const near = safeGet(win, 'near');
  if (safeGet(near, 'isSender')) add('window.near', near, 'sender');
  add('window.nightly.near', safeGet(safeGet(win, 'nightly'), 'near'), 'nightly');
  add('window.okxwallet.near', safeGet(safeGet(win, 'okxwallet'), 'near'), 'okx-wallet');
  return out;
}

/** The detected NEAR wallets from the selector's modules (or, before the
 *  selector is loaded, from the injected objects alone). */
export function nearDetected(modules, injected, ids = new ObjectIds()) {
  const entries = [];
  const injectedById = new Map(injected.map((x) => [x.moduleId, x]));
  if (!modules) {
    for (const x of injected) {
      const e = detectedEntry({ key: `near:injected:${x.moduleId}`, family: 'near', standard: 'injected NEAR object (selector not loaded)', name: x.path, moduleId: x.moduleId }, null);
      e.objectId = ids.id(x.obj);
      e.productId = NEAR_MODULES[x.moduleId] ?? null;
      e.productBy = e.productId ? 'module' : null;
      e.notes.push('Load the NEAR wallet selector to test it.');
      entries.push(e);
    }
    return markShared(entries, 'injected object');
  }
  for (const m of modules) {
    const meta = safeGet(m, 'metadata') ?? {};
    const id = shortText(safeGet(m, 'id'), 40);
    const inj = injectedById.get(id);
    const e = detectedEntry({
      key: `near:selector:${id}`, family: 'near', standard: 'NEAR wallet selector', name: shortText(safeGet(meta, 'name')) ?? id, moduleId: id,
      moduleType: shortText(safeGet(m, 'type'), 20), available: safeGet(meta, 'available') === true, version: shortText(safeGet(meta, 'version'), 20),
    }, m);
    e.objectId = ids.id(inj?.obj ?? m);
    e.productId = NEAR_MODULES[id] ?? null;
    e.productBy = e.productId ? 'module' : null;
    if (safeGet(meta, 'deprecated') === true) e.notes.push('The selector marks this module deprecated.');
    if (e.moduleType === 'injected' && !e.available) e.notes.push('Its extension is not installed in this browser.');
    if (inj) e.notes.push(`Its extension object is ${inj.path}.`);
    entries.push(e);
  }
  return markShared(entries.filter((e) => e.moduleType !== 'injected' || e.available), 'injected object');
}

let selectorPromise = null;

/** Loads the selector with the modules of the curated NEAR wallets, once. */
export function loadNearSelector({ network = 'testnet' } = {}) {
  selectorPromise ??= (async () => {
    const [core, sender, meteor, hot, here, nightly, okx, intear, nearMobile, mnw] = await Promise.all([
      import('@near-wallet-selector/core'),
      import('@near-wallet-selector/sender'),
      import('@near-wallet-selector/meteor-wallet'),
      import('@near-wallet-selector/hot-wallet'),
      import('@near-wallet-selector/here-wallet'),
      import('@near-wallet-selector/nightly'),
      import('@near-wallet-selector/okx-wallet'),
      import('@near-wallet-selector/intear-wallet'),
      import('@near-wallet-selector/near-mobile-wallet'),
      import('@near-wallet-selector/my-near-wallet'),
    ]);
    const selector = await core.setupWalletSelector({
      network,
      modules: [
        sender.setupSender(), meteor.setupMeteorWallet(), hot.setupHotWallet(), here.setupHereWallet(), nightly.setupNightly(),
        okx.setupOKXWallet(), intear.setupIntearWallet(), nearMobile.setupNearMobileWallet(), mnw.setupMyNearWallet(),
      ],
    });
    return selector;
  })().catch((e) => { selectorPromise = null; throw e; });
  return selectorPromise;
}

/** The modules a loaded selector lists. */
export const selectorModules = (selector) => [...(selector?.store?.getState?.().modules ?? [])];
