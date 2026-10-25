// The page's state for this visit: the wallets detected in this browser and
// the visitor's live results. It lives in memory only; nothing is sent to a
// server and nothing survives a reload, except a file the visitor exports.

export class Store extends EventTarget {
  constructor() {
    super();
    /** key -> detected wallet (see detect/index.js) */
    this.detected = new Map();
    /** key -> live result (see probe/result.js) */
    this.results = new Map();
  }

  setDetected(list) {
    for (const d of list) this.detected.set(d.key, d);
    this.emit('detected');
  }

  addDetected(d) {
    this.detected.set(d.key, d);
    this.emit('detected');
  }

  setResult(key, result) {
    this.results.set(key, result);
    this.emit('results');
  }

  emit(what) {
    this.dispatchEvent(new CustomEvent('change', { detail: { what } }));
  }
}
