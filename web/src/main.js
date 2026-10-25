// The page's entry point: the curated data, the detection listeners (they
// start at once, so no wallet announcement is missed), the in-memory store
// and the shell with every registered section.

import data from '../../data/wallets.json';
import sections from 'virtual:sections';
import { buildModel } from './data/model.js';
import { Store } from './app/store.js';
import { startShell } from './app/shell.js';
import { Detector } from './detect/index.js';

const model = buildModel(data);
const detector = new Detector(window);
const store = new Store();
const ctx = { model, store, detector, page: { dataVersion: data.version, dataUpdated: data.updated } };

window.addEventListener('DOMContentLoaded', () => {
  startShell(document.getElementById('app'), sections, ctx);
  // A first, silent detection pass; the detection section can repeat it.
  detector.detect().then((list) => store.setDetected(list)).catch(() => {});
});

// Exposed read-only for the page's own browser tests and for curious
// visitors: the counts and problems of the curated data as loaded.
Object.defineProperty(window, 'walletMatrix', { value: Object.freeze({ model, store }), enumerable: false });
