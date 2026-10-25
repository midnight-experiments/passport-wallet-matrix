// The static build for Cloudflare Pages: web/dist/ holds index.html, the
// hashed script and style assets and a security-headers file, and nothing
// that runs on a server. It needs no network (esbuild only) and refuses to
// finish when the site fails site-check.mjs: a file of 25 MiB or more,
// 20,000 files or more, server code, or this machine's build directory
// named in the output. dist/build-manifest.json lists every file with its
// size and SHA-256.
//
//   node build.mjs [--out <dir>]

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { WEB, REPO, browserOptions } from './esbuild-config.mjs';
import { checkSite, MAX_FILE_BYTES, MAX_FILES } from './site-check.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(WEB, 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

const js = await build({
  ...browserOptions(),
  entryPoints: { app: path.join(WEB, 'src', 'main.js') },
  outdir: path.join(OUT, 'assets'),
  splitting: true,
  minify: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  loader: { '.json': 'json' },
});
const css = await build({
  bundle: true,
  absWorkingDir: WEB,
  entryPoints: { styles: path.join(WEB, 'src', 'styles.css') },
  outdir: path.join(OUT, 'assets'),
  entryNames: '[name]-[hash]',
  minify: true,
  metafile: true,
  logLevel: 'warning',
});

const entryOf = (meta, name) => {
  const out = Object.entries(meta.outputs).find(([, o]) => o.entryPoint && path.basename(o.entryPoint).startsWith(name));
  if (!out) throw new Error(`no output for ${name}`);
  return path.relative(OUT, path.resolve(WEB, out[0])).split(path.sep).join('/');
};
const script = entryOf(js.metafile, 'main');
// The npm packages bundled into the entry script; every other package loads
// on demand, in its own chunk.
const entryInputs = Object.entries(js.metafile.outputs).find(([, o]) => o.entryPoint && path.basename(o.entryPoint).startsWith('main'))[1].inputs;
const entryPackages = [...new Set(Object.keys(entryInputs).map((i) => i.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean))].sort();
const styles = entryOf(css.metafile, 'styles');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').replace('%SCRIPT%', script).replace('%STYLES%', styles);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  X-Frame-Options: DENY',
  '  Permissions-Policy: hid=(self), usb=(self), camera=(), microphone=(), geolocation=()',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n'));

// Checks.
const { list: manifest, problems } = checkSite(OUT, { hostPaths: [WEB, path.join(REPO, 'vendor'), path.join(REPO, 'data')] });
const total = manifest.reduce((n, f) => n + f.bytes, 0);
const largest = manifest.reduce((a, f) => (f.bytes > a.bytes ? f : a), { bytes: 0 });
fs.writeFileSync(path.join(OUT, 'build-manifest.json'), `${JSON.stringify({
  site: 'passport-wallet-matrix', entry: script, styles, entryPackages, files: manifest.length, bytes: total, largest: { path: largest.path, bytes: largest.bytes },
  limits: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES }, list: manifest,
}, null, 1)}\n`);
if (problems.length) {
  console.error(`build refused:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`built ${manifest.length} files, ${total} bytes; largest ${largest.path} (${largest.bytes} bytes); entry ${script}`);
