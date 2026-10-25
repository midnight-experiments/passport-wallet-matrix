// The static build (P1.5): the checks refuse what Pages would refuse or
// what must never be published, and the real build passes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkSite, MAX_FILE_BYTES } from '../../site-check.mjs';

const WEB = process.env.PWM_WEB;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
const site = (files) => {
  const d = tmp();
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    fs.writeFileSync(path.join(d, p), content);
  }
  return d;
};

test('a plain static site passes', () => {
  const r = checkSite(site({ 'index.html': '<p>hi</p>', 'assets/app.js': 'x', _headers: '/*\n' }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.list.length, 3);
  assert.match(r.list[0].sha256, /^[0-9a-f]{64}$/);
});

test('a file of 25 MiB is refused; one byte less passes', () => {
  const big = Buffer.alloc(MAX_FILE_BYTES);
  assert.ok(checkSite(site({ 'assets/big.bin': big })).problems.some((p) => /25 MiB/.test(p)));
  assert.deepEqual(checkSite(site({ 'assets/big.bin': big.subarray(1) })).problems, []);
});

test('server code is refused', () => {
  assert.ok(checkSite(site({ '_worker.js': 'export default {}' })).problems.includes('server code: _worker.js'));
  assert.ok(checkSite(site({ 'functions/api.js': 'export function onRequest() {}' })).problems.includes('server code: functions/'));
  assert.ok(checkSite(site({ '_routes.json': '{}' })).problems.includes('server code: _routes.json'));
});

test('a host path in the output is refused', () => {
  const r = checkSite(site({ 'assets/app.js': 'var p="/home/builder/web/src/main.js"' }), { hostPaths: ['/home/builder/web'] });
  assert.ok(r.problems.some((p) => /names the build directory/.test(p)));
});

test('the real build: no server code, every file under 25 MiB, the page and its lazy chunks', { timeout: 240000 }, () => {
  assert.ok(WEB, 'PWM_WEB is set by test/run-unit.mjs');
  const out = tmp();
  const r = spawnSync(process.execPath, [path.join(WEB, 'build.mjs'), '--out', out], { encoding: 'utf8', cwd: WEB });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const m = JSON.parse(fs.readFileSync(path.join(out, 'build-manifest.json'), 'utf8'));
  assert.ok(m.list.every((f) => f.bytes < MAX_FILE_BYTES));
  assert.deepEqual(checkSite(out, { hostPaths: [WEB] }).problems, []);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(fs.existsSync(path.join(out, m.entry)) && html.includes(`src="${m.entry}"`));
  assert.ok(fs.existsSync(path.join(out, m.styles)) && html.includes(`href="${m.styles}"`));
  assert.ok(fs.existsSync(path.join(out, '_headers')));
  // The wallet and device libraries load only when used: the entry holds
  // none of them.
  const entryBytes = m.list.find((f) => f.path === m.entry).bytes;
  assert.ok(entryBytes < 1024 * 1024, `the entry is ${entryBytes} bytes`);
  assert.deepEqual(m.entryPackages.filter((p) => /^@(near-wallet-selector|ledgerhq|trezor|near-js)\//.test(p)), []);
  assert.ok(m.entryPackages.includes('@noble/curves'), m.entryPackages.join(','));
});
