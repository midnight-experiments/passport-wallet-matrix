// The page in a headless Chromium, from the static build, with no network:
//   1. no wallet: every curated row and cell renders, with reasons and
//      evidence; legacy rows greyed; via rows folded; the Cardano label;
//   2. mock wallets of each standard, including one extension that answers
//      as MetaMask too: detected, identified by provider object, shown as
//      reported, never as a curated row's result;
//   3. "test my wallet" on mock wallets of three families, the readable
//      answer, the export and its import (and a changed file refused).
//
//   node test/browser/run.mjs --dist <dir> --out <dir>
// Needs playwright-core and a Chromium of the same version (the Playwright
// image provides it).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { WEB, browserOptions } from '../../esbuild-config.mjs';
import data from '../../../data/wallets.json' with { type: 'json' };

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const DIST = path.resolve(arg('--dist', path.join(WEB, 'dist')));
const OUT = path.resolve(arg('--out', path.join(WEB, '.test-build', 'browser')));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); };

// The static site, served from the build only.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = path.join(DIST, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const mocks = (await build({ ...browserOptions(), entryPoints: [path.join(WEB, 'test', 'browser', 'mocks-entry.mjs')], write: false, format: 'iife', splitting: false, minify: true })).outputFiles[0].text;

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const external = [];
async function newPage(cfg) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 } });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    external.push(u);
    return route.abort();
  });
  if (cfg) await context.addInitScript({ content: `${mocks}\nwindow.__installWalletMocks(${JSON.stringify(cfg)});` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('table.matrix');
  return { context, page, errors };
}

// ── 1. No wallet ────────────────────────────────────────────────────────────
{
  const { context, page, errors } = await newPage(null);
  for (const fam of data.families) {
    await page.click(`button.fam-btn[data-family="${fam.id}"]`);
    await page.waitForSelector(`table.matrix[data-family="${fam.id}"]`);
    const rows = data.rows.filter((r) => r.family === fam.id);
    const info = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('table.matrix tr.crow')];
      return {
        ids: trs.map((t) => t.dataset.row),
        cells: trs.map((t) => [...t.querySelectorAll('td.cell')].map((td) => ({
          cap: td.dataset.capability, value: td.dataset.value,
          reason: td.querySelector('.reason')?.textContent ?? '', evidence: td.querySelectorAll('ul.evidence li').length,
        }))),
        legacy: trs.filter((t) => t.classList.contains('legacy')).map((t) => t.dataset.row),
        greyed: trs.filter((t) => t.classList.contains('legacy')).every((t) => Number(getComputedStyle(t).opacity) < 1),
        hiddenVia: trs.filter((t) => t.dataset.path === 'via' && t.hidden).length,
        via: trs.filter((t) => t.dataset.path === 'via').length,
        detectedNone: document.querySelector('tbody.detected tr.none')?.textContent ?? '',
        testOnly: document.querySelector('.family-view .test-only')?.textContent ?? '',
      };
    });
    check(`${fam.id}: every curated row is in the table`, JSON.stringify([...info.ids].sort()) === JSON.stringify(rows.map((r) => r.id).sort()), `${info.ids.length}/${rows.length}`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let bad = 0;
    info.ids.forEach((id, i) => {
      const r = byId.get(id);
      const cells = info.cells[i];
      if (cells.length !== 5) bad++;
      for (const c of cells) {
        const want = r?.cells[c.cap];
        if (!want || c.value !== want.value || c.reason !== want.reason || c.evidence !== want.evidence.length) bad++;
      }
    });
    check(`${fam.id}: every cell shows the data's value, reason and evidence`, bad === 0, `${bad} mismatches over ${info.ids.length * 5} cells`);
    const legacyIds = rows.filter((r) => r.state === 'legacy').map((r) => r.id).sort();
    check(`${fam.id}: legacy rows are marked and greyed`, JSON.stringify([...info.legacy].sort()) === JSON.stringify(legacyIds) && (legacyIds.length === 0 || info.greyed), `${info.legacy.length} legacy`);
    check(`${fam.id}: via rows are folded (hidden until opened)`, info.via === info.hiddenVia && info.via === rows.filter((r) => r.path.type === 'via').length, `${info.hiddenVia}/${info.via}`);
    check(`${fam.id}: no wallet detected is said`, /No wallet of this family was detected/.test(info.detectedNone));
    if (fam.id === 'cardano') check('cardano: the test-only label is shown', /test only, address not bound/.test(info.testOnly), info.testOnly);
  }
  // Open one device's via rows.
  await page.click('button.fam-btn[data-family="evm"]');
  await page.click('button.via-toggle[data-device="ledger--evm"]');
  const shown = await page.evaluate(() => [...document.querySelectorAll('tr.crow.via')].filter((t) => !t.hidden).map((t) => t.dataset.row));
  check('the Ledger EVM toggle opens its via rows, and only them', shown.length === data.rows.filter((r) => r.product === 'ledger' && r.family === 'evm' && r.path.type === 'via').length && shown.every((id) => id.startsWith('ledger--evm--via-')), shown.join(','));
  await page.click('td.cell[data-capability="signs-format"] details >> nth=0');
  await page.screenshot({ path: path.join(OUT, 'table-no-wallet.png'), fullPage: false });
  await page.click('a#tab-detect');
  await page.waitForSelector('#pane-detect .detected-list h3');
  const none = await page.textContent('#pane-detect');
  check('no wallet: the detection lists none in each family', (none.match(/None detected\./g) ?? []).length === 4);
  check('no wallet: no page error', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ── 2. Detection with mock wallets ──────────────────────────────────────────
const cfg = { evm: true, impersonator: true, hedgedEvm: true, solana: true, cardano: true, near: true };
const { context, page, errors } = await newPage(cfg);
await page.click('a#tab-detect');
await page.waitForSelector('.detected-entry');
await page.waitForTimeout(600);
const det = await page.evaluate(() => [...document.querySelectorAll('.detected-entry')].map((e) => ({
  key: e.dataset.detected, text: e.textContent, warnings: e.querySelectorAll('.warnings li').length,
})));
const find = (k) => det.find((d) => d.key === k);
check('EIP-6963: the genuine MetaMask mock is detected, reported by the wallet', find('evm:eip6963:mock-metamask')?.text.includes('(reported by the wallet)'));
check('EIP-6963: the impersonating extension is detected under both of its names', !!find('evm:eip6963:mock-nufi') && !!find('evm:eip6963:mock-fake-metamask'));
check('EIP-6963: both of its entries carry the shared-object warning', find('evm:eip6963:mock-nufi')?.warnings > 0 && find('evm:eip6963:mock-fake-metamask')?.warnings > 0 && /also answers as NUFI/.test(find('evm:eip6963:mock-fake-metamask')?.text ?? ''));
check('EIP-6963: the genuine MetaMask has no warning and its own provider object', find('evm:eip6963:mock-metamask')?.warnings === 0);
check('Wallet Standard: the Phantom mock is detected, with its supportedMessageVersions', det.some((d) => d.key.startsWith('solana:ws:') && /Phantom/.test(d.text) && /supportedMessageVersions: \[1\]/.test(d.text)));
check('CIP-30: the eternl mock is detected', !!find('cardano:cip30:eternl'));
check('NEAR: the injected Sender object is noted before the selector loads', !!find('near:injected:sender'));
await page.screenshot({ path: path.join(OUT, 'detected.png'), fullPage: true });

// The NEAR wallet selector, loaded on request with no network: its modules
// are listed, and the injected Sender object is found through its module.
await page.click('#pane-detect .detect-controls button:nth-child(2)');
await page.waitForFunction(() => /NEAR wallet selector (lists|could not)/.test(document.querySelector('#pane-detect .status')?.textContent ?? ''), null, { timeout: 60000 });
const nearStatus = await page.textContent('#pane-detect .status');
const nearKeys = await page.evaluate(() => [...document.querySelectorAll('.detected-entry')].map((e) => e.dataset.detected).filter((k) => k.startsWith('near:')));
check('NEAR: the wallet selector loads with no network and lists its modules', /lists \d+ modules/.test(nearStatus), nearStatus);
check('NEAR: the selector finds the injected Sender object through its module', nearKeys.includes('near:selector:sender'), nearKeys.join(','));
check('NEAR: a module that checks for its extension and finds none (OKX) is not listed', !nearKeys.includes('near:selector:okx-wallet'), nearKeys.join(','));
await page.screenshot({ path: path.join(OUT, 'detected-near.png'), fullPage: true });

// The table shows detected wallets as their own rows; curated rows unchanged.
await page.click('a#tab-table');
await page.click('button.fam-btn[data-family="evm"]');
const evmTable = await page.evaluate(() => ({
  detected: [...document.querySelectorAll('tbody.detected tr.drow')].map((t) => ({ key: t.dataset.detected, untested: [...t.querySelectorAll('td.cell')].every((c) => c.dataset.value === 'untested'), text: t.textContent })),
  metamask: [...document.querySelectorAll('tr.crow[data-row="metamask--evm"] td.cell')].map((c) => c.dataset.value),
}));
const mmWant = Object.values(data.rows.find((r) => r.id === 'metamask--evm').cells).map((c) => c.value);
check('table: the detected EVM wallets are listed as untested rows', evmTable.detected.length === 4 && evmTable.detected.every((d) => d.untested), evmTable.detected.map((d) => d.key).join(','));
check('table: the impersonator\'s row says its name points to the MetaMask row, as reported', /reported by the wallet/.test(evmTable.detected.find((d) => d.key === 'evm:eip6963:mock-fake-metamask')?.text ?? '') && /points to the curated row MetaMask/.test(evmTable.detected.find((d) => d.key === 'evm:eip6963:mock-fake-metamask')?.text ?? ''));
check('table: the curated MetaMask row keeps the data\'s values', JSON.stringify(evmTable.metamask) === JSON.stringify(mmWant), evmTable.metamask.join(','));

// ── 3. Test my wallet ───────────────────────────────────────────────────────
async function runTest(key) {
  await page.click('a#tab-test');
  await page.selectOption('select.wallet-select', key);
  await page.click('button.run-btn');
  await page.waitForSelector('.test-out .result', { timeout: 60000 });
  return page.evaluate(() => ({
    cells: Object.fromEntries([...document.querySelectorAll('.test-out table.verdict tbody tr')].map((tr) => [tr.dataset.capability, { value: tr.querySelector('td .vbadge')?.className.match(/v-([a-z-]+)/)?.[1], compare: tr.dataset.compare }])),
    steps: [...document.querySelectorAll('.test-out li.step')].map((li) => [li.dataset.step, li.dataset.outcome]),
    reasons: [...document.querySelectorAll('.test-out li.step .sreason')].map((x) => x.textContent),
  }));
}

const mm = await runTest('evm:eip6963:mock-metamask');
check('test: MetaMask mock connects, signs the V1 typed data and personal_sign, repeats', mm.cells.connects.value === 'check' && mm.cells['signs-format'].value === 'check' && mm.cells.deterministic.value === 'check', JSON.stringify(mm.cells));
check('test: every step verified', mm.steps.every(([, o]) => o === 'ok' || o === 'verified') && mm.steps.length === 5, JSON.stringify(mm.steps));
check('test: compared with the curated MetaMask row (same where both are measured)', mm.cells.connects.compare === 'same' && mm.cells['signs-format'].compare === 'same' && mm.cells.deterministic.compare === 'same' && mm.cells.readable.compare === 'not-compared');
await page.check('.test-out .readable-q input[value="yes"]');
await page.waitForSelector('.test-out .differs-note');
const differsText = await page.textContent('.test-out .differs-note');
check('test: answering "readable" makes the page say where it differs from the baseline', /differs from the curated row in: Shows readable text/.test(differsText), differsText);
await page.screenshot({ path: path.join(OUT, 'test-metamask.png'), fullPage: true });

const [download] = await Promise.all([page.waitForEvent('download'), page.click('.test-out button.export-btn')]);
const file = path.join(OUT, 'exported-metamask-mock.json');
await download.saveAs(file);
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
check('export: the file is a live result with the wallet surface, methods, formats and verdict', exported.format === 'passport-wallet-matrix/live-result' && exported.wallet.surface.product === 'MetaMask' && exported.steps.some((s) => s.method === 'eth_signTypedData_v4') && exported.cells.readable.value === 'check');
await page.setInputFiles('#pane-test input[type="file"]', file);
await page.waitForSelector('.import-out .ok, .import-out .error');
check('import: the exported file checks out in the page', (await page.textContent('.import-out')).includes('The file checks out'));
const tampered = path.join(OUT, 'exported-metamask-mock-tampered.json');
exported.cells.deterministic.value = 'cross';
fs.writeFileSync(tampered, JSON.stringify(exported));
await page.setInputFiles('#pane-test input[type="file"]', tampered);
await page.waitForSelector('.import-out .error');
check('import: a changed file is refused', /not accepted/.test(await page.textContent('.import-out')));

const hedged = await runTest('evm:eip6963:mock-hedged');
check('test: a hedged EVM signer is not deterministic', hedged.cells.deterministic.value === 'cross' && hedged.cells['signs-format'].value === 'check', JSON.stringify(hedged.cells));
const fake = await runTest('evm:eip6963:mock-fake-metamask');
check('test: the impersonator\'s own result is its own', fake.cells['signs-format'].value === 'check');
const sol = await runTest(det.find((d) => d.key.startsWith('solana:ws:')).key);
check('test: the Phantom mock signs raw and repeats', sol.cells['signs-format'].value === 'check' && sol.cells.deterministic.value === 'check' && sol.steps.some(([id, o]) => id === 'probe:raw' && o === 'verified'), JSON.stringify(sol.steps));
const near = await runTest('near:selector:sender');
check('test: the Sender mock signs NEP-413 through the selector, callbackUrl absent, and repeats', near.cells['signs-format'].value === 'check' && near.cells.deterministic.value === 'check', JSON.stringify([near.steps, near.reasons]));
const ada = await runTest('cardano:cip30:eternl');
check('test: the eternl mock signs CIP-8 layout 1 unhashed through the reward address', ada.cells['signs-format'].value === 'check' && ada.steps.some(([id, o]) => id === 'probe:x-text' && o === 'verified'), JSON.stringify(ada.steps));

await page.click('a#tab-table');
await page.click('button.fam-btn[data-family="evm"]');
const after = await page.evaluate(() => ({
  fake: [...document.querySelectorAll('tbody.detected tr.drow[data-detected="evm:eip6963:mock-fake-metamask"] td.cell')].map((c) => c.dataset.value),
  metamask: [...document.querySelectorAll('tr.crow[data-row="metamask--evm"] td.cell')].map((c) => c.dataset.value),
}));
check('table: after the tests the impersonator\'s row shows its live result', after.fake.length === 5 && !after.fake.includes('untested'));
check('table: the curated MetaMask row is still the data\'s, never a live result', JSON.stringify(after.metamask) === JSON.stringify(mmWant));
await page.screenshot({ path: path.join(OUT, 'table-after-tests.png'), fullPage: false });
const stray = await page.evaluate(() => (document.body.innerText.match(/\b(null|undefined)\b|\[object Object\]/g) ?? []).length);
check('no stray null, undefined or [object Object] in the page text', stray === 0, String(stray));
check('mock run: no page error', errors.length === 0, errors.join(' | '));
check('no request left the page\'s own origin', external.length === 0, external.join(' '));
await context.close();
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1)}\n`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
