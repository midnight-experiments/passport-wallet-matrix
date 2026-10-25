#!/usr/bin/env node
// The key-set manifest: every circuit a test account can carry, with the SHA-256 and size of its
// prover key, verifier key and ZKIR (binary and JSON), and its rows and k.
//
//   node scripts/keyset-manifest.mjs describe <compiled-account-dir> [--zkir-v3 <path>] [--jobs <n>]
//       One JSON record per circuit of the build (all arms), for build records.
//   node scripts/keyset-manifest.mjs build <compiled-account-dir> [--zkir-v3 <path>] [--jobs <n>]
//       The manifest of the key set (the shared circuits and the included arms' circuits), with
//       its key-set id, on stdout.
//   node scripts/keyset-manifest.mjs check <manifest.json> [<key-dir>]
//       Checks the manifest's shape and key-set id; with <key-dir>, also every listed file's size
//       and SHA-256. <key-dir> is either a compiler output directory (keys/ and zkir/) or a flat
//       directory of release assets.
//
// The key-set id is the lowercase hex SHA-256 of the canonical manifest: the manifest without its
// `keySetId` member, serialised as JSON with every object's members sorted by name, arrays in
// order, no whitespace, integers only, UTF-8. Anyone holding the manifest can recompute it.
//
// Rows and k come from `zkir-v3 mock-compile`, run on a copy of each `.zkir` in a temporary
// directory so the build directory is never written to.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'passport-wallet-matrix-keyset/1';

// The arms whose circuits a test account can carry. The upstream arms (jubjub, k256, p256) are
// compiled into the same contract but are not part of the key set: test accounts never carry them.
const INCLUDED_ARMS = ['evm_k256', 'sol_ed25519'];
const EXCLUDED_ARMS = ['jubjub', 'k256', 'p256'];
// Longest suffix first, so `_evm_k256` is never read as the `k256` arm.
const ARM_SUFFIXES = [...INCLUDED_ARMS, ...EXCLUDED_ARMS].sort((a, b) => b.length - a.length);

const SOURCE = {
  repository: 'https://github.com/midnightntwrk/passport',
  commit: '048174b0911ffb7cca8fb0c082f01ee746ed16e3',
  vendored: 'vendor/passport',
};
const COMPILER = {
  compactc: '0.35.0 (debb05f94 2026-09-29)',
  release: 'https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.35.0',
  flags: ['--feature-zkir-v3'],
};
const FILE_KINDS = [
  ['prover', 'keys', '.prover'],
  ['verifier', 'keys', '.verifier'],
  ['bzkir', 'zkir', '.bzkir'],
  ['zkir', 'zkir', '.zkir'],
];
const HEX64 = /^[0-9a-f]{64}$/;
const CIRCUIT_NAME = /^[a-z0-9_]+$/;

function fail(message) {
  console.error(`keyset-manifest: ${message}`);
  process.exit(1);
}

/** Canonical JSON: sorted members, no whitespace, integers only. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`not an integer: ${value}`);
  if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new Error(`unsupported value: ${typeof value}`);
  return JSON.stringify(value);
}

export function keySetId(manifest) {
  const { keySetId: _ignored, ...rest } = manifest;
  return createHash('sha256').update(canonical(rest), 'utf8').digest('hex');
}

export function armOf(circuit) {
  for (const arm of ARM_SUFFIXES) if (circuit.endsWith(`_${arm}`)) return arm;
  return 'shared';
}

function operationOf(circuit, arm) {
  return arm === 'shared' ? circuit : circuit.slice(0, -(arm.length + 1));
}

function sha256File(path) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', ko)
      .on('end', () => ok(h.digest('hex')));
  });
}

async function fileRecord(path) {
  if (!existsSync(path)) fail(`missing ${path}`);
  return { sha256: await sha256File(path), size: statSync(path).size };
}

function mockCompile(zkirV3, zkirPath) {
  const dir = mkdtempSync(join(tmpdir(), 'keyset-mock-'));
  const copy = join(dir, zkirPath.split('/').pop());
  copyFileSync(zkirPath, copy);
  return new Promise((ok, ko) => {
    let out = '';
    const p = spawn(zkirV3, ['mock-compile', copy], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', ko);
    p.on('close', (code) => {
      rmSync(dir, { recursive: true, force: true });
      const m = /k=(\d+), rows=(\d+)/.exec(out);
      if (code !== 0 || !m) return ko(new Error(`mock-compile ${zkirPath} failed (${code}): ${out.slice(-300)}`));
      ok({ k: Number(m[1]), rows: Number(m[2]) });
    });
  });
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

/** Every circuit of a compiler output directory, with its arm, rows, k and files. */
async function describe(dir, zkirV3, jobs) {
  const zdir = join(dir, 'zkir');
  if (!existsSync(zdir)) fail(`${zdir} does not exist (compile first)`);
  const circuits = readdirSync(zdir)
    .filter((f) => f.endsWith('.zkir'))
    .map((f) => f.slice(0, -'.zkir'.length))
    .sort();
  if (circuits.length === 0) fail(`no .zkir in ${zdir}`);
  const keyed = existsSync(join(dir, 'keys'));
  const workers = jobs ?? Math.max(1, Math.min(8, cpus().length >> 1));
  return pool(circuits, workers, async (name) => {
    const arm = armOf(name);
    const files = {};
    for (const [kind, sub, ext] of FILE_KINDS) {
      const path = join(dir, sub, name + ext);
      if (!keyed && sub === 'keys') continue;
      if (!existsSync(path) && kind === 'bzkir' && !keyed) continue;
      files[kind] = { name: name + ext, ...(await fileRecord(path)) };
    }
    return { name, arm, operation: operationOf(name, arm), ...(await mockCompile(zkirV3, join(zdir, `${name}.zkir`))), files };
  });
}

/**
 * The verifier-key SHA-256 per circuit that a keyed build writes into the generated module
 * (`export const expectedVk = { '<circuit>': '<sha256>', ... }`), or null for a `--skip-zk` build.
 */
function expectedVerifierKeys(dir) {
  const js = readFileSync(join(dir, 'contract', 'index.js'), 'utf8');
  const start = js.indexOf('export const expectedVk = {');
  if (start < 0) return null;
  const body = js.slice(start, js.indexOf('};', start));
  const out = new Map();
  for (const m of body.matchAll(/'([a-z0-9_]+)': '([0-9a-f]{64})'/g)) out.set(m[1], m[2]);
  return out.size ? out : null;
}

/** Structural rules every key set obeys; returns a list of problems. */
function shapeProblems(m) {
  const p = [];
  if (m.format !== FORMAT) p.push(`format is ${JSON.stringify(m.format)}, expected ${FORMAT}`);
  if (!HEX64.test(m.keySetId ?? '')) p.push('keySetId is not 64 lowercase hex digits');
  if (!Array.isArray(m.arms) || m.arms.length === 0) p.push('arms is empty');
  if (!Array.isArray(m.circuits) || m.circuits.length === 0) return [...p, 'circuits is empty'];
  const names = m.circuits.map((c) => c.name);
  if (new Set(names).size !== names.length) p.push('duplicate circuit names');
  if (names.join('\n') !== [...names].sort().join('\n')) p.push('circuits are not sorted by name');
  const ops = new Map();
  for (const c of m.circuits) {
    if (!CIRCUIT_NAME.test(c.name ?? '')) p.push(`bad circuit name ${JSON.stringify(c.name)}`);
    if (c.arm !== armOf(c.name)) p.push(`${c.name}: arm ${c.arm}, its name says ${armOf(c.name)}`);
    if (c.arm !== 'shared' && !m.arms.includes(c.arm)) p.push(`${c.name}: arm ${c.arm} is not in the key set's arms`);
    if (!Number.isSafeInteger(c.k) || c.k < 1 || c.k > 25) p.push(`${c.name}: bad k`);
    if (!Number.isSafeInteger(c.rows) || c.rows < 1 || c.rows > 2 ** c.k) p.push(`${c.name}: rows do not fit k`);
    for (const [kind, , ext] of FILE_KINDS) {
      const f = c.files?.[kind];
      if (!f) p.push(`${c.name}: no ${kind} file`);
      else {
        if (f.name !== c.name + ext) p.push(`${c.name}: ${kind} file is named ${f.name}`);
        if (!HEX64.test(f.sha256 ?? '')) p.push(`${c.name}: ${kind} sha256 malformed`);
        if (!Number.isSafeInteger(f.size) || f.size <= 0) p.push(`${c.name}: ${kind} size malformed`);
      }
    }
    if (Object.keys(c.files ?? {}).length !== FILE_KINDS.length) p.push(`${c.name}: unexpected files`);
    const set = ops.get(c.arm) ?? new Set();
    set.add(operationOf(c.name, c.arm));
    ops.set(c.arm, set);
  }
  // Every arm in the set carries the same operations: an account can add a device of any arm and
  // run every operation with it.
  const armOps = m.arms.map((a) => [a, [...(ops.get(a) ?? [])].sort().join(',')]);
  for (const [a, o] of armOps) {
    if (o === '') p.push(`arm ${a} has no circuits`);
    else if (o !== armOps[0][1]) p.push(`arm ${a} carries other operations than arm ${armOps[0][0]}`);
  }
  if (!ops.get('shared')?.size) p.push('no shared circuits');
  return p;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const zkirV3 = opt['zkir-v3'] ?? join(ROOT, '.tools/compactc-0.35.0/zkir-v3');
  if (cmd === 'describe' || cmd === 'build') {
    if (pos.length !== 1) fail(`usage: ${cmd} <compiled-account-dir> [--zkir-v3 <path>]`);
    if (!existsSync(zkirV3)) fail(`${zkirV3} not found (run scripts/fetch-compactc.sh)`);
    const jobs = opt.jobs === undefined ? undefined : Number(opt.jobs);
    if (jobs !== undefined && !(Number.isSafeInteger(jobs) && jobs > 0)) fail('--jobs takes a positive integer');
    const all = await describe(resolve(pos[0]), zkirV3, jobs);
    if (cmd === 'describe') {
      process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
      return;
    }
    // The generated module checks verifier keys against its own list: a key set must agree with it.
    const expected = expectedVerifierKeys(resolve(pos[0]));
    if (!expected) fail('the generated module has no expectedVk list (a manifest needs a keyed build)');
    for (const c of all) {
      if (expected.get(c.name) !== c.files.verifier?.sha256) fail(`${c.name}: verifier key differs from the generated module's expectedVk`);
    }
    if (expected.size !== all.length) fail(`expectedVk lists ${expected.size} circuits, the build has ${all.length}`);
    const unknown = all.filter((c) => c.arm !== 'shared' && !INCLUDED_ARMS.includes(c.arm) && !EXCLUDED_ARMS.includes(c.arm));
    if (unknown.length) fail(`unclassified circuits: ${unknown.map((c) => c.name).join(', ')}`);
    const circuits = all
      .filter((c) => c.arm === 'shared' || INCLUDED_ARMS.includes(c.arm))
      .map(({ name, arm, k, rows, files }) => {
        if (Object.keys(files).length !== FILE_KINDS.length) fail(`${name}: a manifest needs a keyed build (prover and verifier keys)`);
        return { name, arm, k, rows, files };
      });
    const manifest = { format: FORMAT, contract: 'account', source: SOURCE, compiler: COMPILER, arms: INCLUDED_ARMS, circuits };
    const withId = { format: FORMAT, keySetId: keySetId(manifest), ...manifest };
    const problems = shapeProblems(withId);
    if (problems.length) fail(`the built manifest breaks its own rules:\n  ${problems.join('\n  ')}`);
    process.stdout.write(`${JSON.stringify(withId, null, 2)}\n`);
    return;
  }
  if (cmd === 'check') {
    if (pos.length < 1 || pos.length > 2) fail('usage: check <manifest.json> [<key-dir>]');
    const m = JSON.parse(readFileSync(pos[0], 'utf8'));
    const problems = shapeProblems(m);
    const id = keySetId(m);
    if (id !== m.keySetId) problems.push(`keySetId ${m.keySetId} does not match the canonical manifest's SHA-256 ${id}`);
    if (pos[1]) {
      const dir = resolve(pos[1]);
      const layout = existsSync(join(dir, 'keys')) ? 'compiler' : 'flat';
      for (const c of m.circuits ?? []) {
        for (const [kind, sub] of FILE_KINDS) {
          const f = c.files?.[kind];
          if (!f) continue;
          const path = layout === 'compiler' ? join(dir, sub, f.name) : join(dir, f.name);
          if (!existsSync(path)) {
            problems.push(`${f.name}: missing`);
            continue;
          }
          const size = statSync(path).size;
          if (size !== f.size) problems.push(`${f.name}: size ${size}, manifest ${f.size}`);
          else if ((await sha256File(path)) !== f.sha256) problems.push(`${f.name}: SHA-256 differs from the manifest`);
        }
      }
      console.error(`keyset-manifest: checked ${(m.circuits ?? []).length} circuits' files in ${dir} (${layout} layout)`);
    }
    if (problems.length) fail(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    console.log(`keyset-manifest: OK, key set ${m.keySetId}, ${m.circuits.length} circuits (arms: shared, ${m.arms.join(', ')})`);
    return;
  }
  fail('usage: keyset-manifest.mjs describe|build <compiled-account-dir> | check <manifest.json> [<key-dir>]');
}

// Run only as a command, so other modules can import `canonical`, `keySetId` and `armOf`.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => fail(e.stack ?? String(e)));
}
