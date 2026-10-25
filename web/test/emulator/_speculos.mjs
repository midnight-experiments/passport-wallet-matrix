// Ledger's emulator, Speculos, for the direct-path tests: a Ledger transport
// over its REST /apdu endpoint (the page's own Ledger code runs on it
// unchanged), and a screen driver that plays the user on a Flex (touch)
// while the page's requests are pending: it swipes through review pages,
// holds "Hold to sign", taps the confirmation and warning buttons, and
// returns to the home screen after a refusal. Every screen it acts on is
// recorded. Speculos runs with its default public test mnemonic only.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TransportPkg = require('@ledgerhq/hw-transport');
const Transport = TransportPkg.default ?? TransportPkg;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (ev) => ev.map((e) => e.text).join('\n');
const center = (e) => ({ x: Math.round(e.x + e.w / 2), y: Math.round(e.y + e.h / 2) });

export class SpeculosApi {
  constructor(base) { this.base = base.replace(/\/$/, ''); }
  async json(method, p, body) {
    const r = await fetch(`${this.base}${p}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`speculos ${method} ${p}: HTTP ${r.status}`);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
  async screen() { return (await this.json('GET', '/events?currentscreenonly=true')).events ?? []; }
  finger(x, y, { x2, y2, delay = 0.1 } = {}) { return this.json('POST', '/finger', { action: 'press-and-release', x, y, ...(x2 != null ? { x2, y2 } : {}), delay }); }
}

/** A Ledger transport over Speculos' REST APDU endpoint. It counts pending
 *  exchanges, so the screen driver knows when the device is waiting. */
export class SpeculosTransport extends Transport {
  constructor(base) {
    super();
    this.base = base.replace(/\/$/, '');
    this.pending = 0;
    this.lastActivity = Date.now();
    this.apdus = [];
  }
  async exchange(apdu) {
    this.pending++;
    this.lastActivity = Date.now();
    try {
      const r = await fetch(`${this.base}/apdu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Buffer.from(apdu).toString('hex') }) });
      if (!r.ok) throw new Error(`speculos /apdu: HTTP ${r.status}`);
      const { data } = await r.json();
      const resp = Buffer.from(data, 'hex');
      this.apdus.push({ cla: apdu[0], ins: apdu[1], p1: apdu[2], p2: apdu[3], bytes: apdu.length, sw: resp.subarray(resp.length - 2).toString('hex') });
      return resp;
    } finally {
      this.pending--;
      this.lastActivity = Date.now();
    }
  }
  setScrambleKey() {}
  async close() {}
}

const HOME = [/is ready/i, /This app enables/i, /app is ready/i];
const isHome = (text) => HOME.some((re) => re.test(text));
const TAP = [/^Continue anyway$/i, /^Accept risk and continue$/i, /^I understand$/i, /^Got it$/i, /^Tap to continue$/i, /^Confirm$/i, /^Continue$/i];
const DISMISS = [/^Back to safety$/i, /^Go back$/i, /^Reject( transaction| message)?$/i, /^Close$/i, /^OK$/i, /^Back$/i];

/**
 * Plays the user while `work()` runs: approves every request the page
 * makes, and returns to the home screen after a refusal. Returns work()'s
 * value and the screens acted on.
 */
export async function withDriver(api, transport, work, { flex = { hold: { x: 240, y: 435, seconds: 3 }, center: { x: 240, y: 300 } } } = {}) {
  const screens = [];
  let done = false, lastKey = '', repeats = 0;
  const loop = (async () => {
    while (!done) {
      let ev;
      try { ev = await api.screen(); } catch { await sleep(200); continue; }
      const text = textOf(ev);
      const key = JSON.stringify(ev.map((e) => [e.text, e.x, e.y]));
      if (!ev.length || /^Processing$/m.test(text)) { await sleep(150); continue; }
      const idle = transport.pending === 0 && Date.now() - transport.lastActivity > 1500;
      let act = null;
      if (isHome(text)) { await sleep(150); continue; }
      if (idle) {
        const b = ev.find((e) => DISMISS.some((re) => re.test(e.text.trim())));
        act = b ? { kind: 'tap', ...center(b), note: `dismiss "${b.text}"` } : { kind: 'tap', ...flex.center, note: 'dismiss (tap)' };
      } else if (transport.pending > 0) {
        const hold = ev.find((e) => /^Hold to (sign|confirm|approve)/i.test(e.text));
        const tap = ev.find((e) => TAP.some((re) => re.test(e.text.trim())));
        if (hold) act = { kind: 'hold', ...flex.hold, note: `"${hold.text}"` };
        else if (tap) act = { kind: 'tap', ...center(tap), note: `"${tap.text}"` };
        else act = { kind: 'swipe', ...flex.center, note: 'next page' };
      }
      if (!act) { await sleep(150); continue; }
      repeats = key === lastKey ? repeats + 1 : 0;
      lastKey = key;
      if (repeats > 40) { screens.push({ text, action: 'stuck' }); await sleep(500); continue; }
      screens.push({ text: text.slice(0, 400), action: act.note });
      if (act.kind === 'hold') await api.finger(act.x, act.y, { delay: act.seconds });
      else if (act.kind === 'tap') await api.finger(act.x, act.y, { delay: 0.1 });
      else await api.finger(act.x, act.y, { x2: act.x - 10, y2: act.y, delay: 0.3 });
      await sleep(350);
    }
  })();
  try {
    return { value: await work(), screens };
  } finally {
    done = true;
    await loop;
  }
}

/** Waits for the app's home screen. */
export async function waitHome(api, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (isHome(textOf(await api.screen()))) return true; } catch { /* starting */ }
    await sleep(300);
  }
  throw new Error('Speculos did not reach the app home screen');
}

/** Turns the Ethereum app's blind-signing setting on, through its own
 *  settings screen (Flex positions: the settings icon at the top right of
 *  the home screen, the "Blind signing" switch on the first settings page,
 *  the back arrow at the top left). */
export async function enableBlindSigning(api) {
  await waitHome(api);
  await api.finger(405, 75); await sleep(800);
  const settings = textOf(await api.screen());
  if (!/Blind signing/i.test(settings)) throw new Error(`not the settings page: ${settings.slice(0, 200)}`);
  await api.finger(420, 350); await sleep(800);
  const after = textOf(await api.screen());
  await api.finger(52, 48); await sleep(800);
  await waitHome(api, 10000).catch(async () => { await api.finger(52, 550); });
  return { settings: settings.slice(0, 300), after: after.slice(0, 300) };
}
