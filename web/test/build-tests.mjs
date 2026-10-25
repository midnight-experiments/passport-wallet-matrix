// Bundles the Node tests (test/unit/*.test.mjs and test/emulator/*.mjs)
// with the page's own bundler settings, so the tests run the same modules
// the page ships, the vendored TypeScript included. npm packages stay
// external and load from web/node_modules.
//
//   node test/build-tests.mjs [--out <dir>]

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { WEB, commonOptions } from '../esbuild-config.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(WEB, '.test-build');

const entries = {};
for (const dir of ['unit', 'emulator']) {
  const d = path.join(WEB, 'test', dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.test.mjs') || (dir === 'emulator' && f.endsWith('.mjs') && !f.startsWith('_'))) entries[`${dir}/${f.replace(/\.mjs$/, '')}`] = path.join(d, f);
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
await build({
  ...commonOptions(),
  entryPoints: entries,
  outdir: OUT,
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  loader: { '.json': 'json' },
});
// The bundles import npm packages by name; Node resolves them from the
// nearest node_modules above the bundle.
if (!OUT.startsWith(WEB + path.sep)) {
  fs.symlinkSync(path.join(WEB, 'node_modules'), path.join(OUT, 'node_modules'), 'dir');
}
console.log(`bundled ${Object.keys(entries).length} test files into ${path.relative(WEB, OUT) || OUT}`);
