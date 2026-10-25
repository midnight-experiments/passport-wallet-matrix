// Mutation testing of the page's rules: the verdict, the per-family
// signature checks, the result file's self-check, detection's identity
// warnings, the version warnings and the table model. Each mutant changes
// one rule in a scratch copy of web/; the unit tests must fail on it (the
// mutant is killed by behaviour, never by reading the source). The working
// tree is never touched.
//
//   node test/mutants/run.mjs --work <scratch dir> [--out <results.json>] [--only id,id]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WEB, REPO } from '../../esbuild-config.mjs';

export const MUTANTS = [
  // The verdict (src/probe/verdict.js).
  ['V01-wrong-counts-as-verified', 'src/probe/verdict.js', "const isVerified = (s) => s?.outcome === 'verified';", "const isVerified = (s) => s?.outcome === 'verified' || s?.outcome === 'wrong-signature';"],
  ['V02-evm-ignores-wrong-signature', 'src/probe/verdict.js', 'const wrong = [...typed, ...personal].find(isWrong);', 'const wrong = undefined;'],
  ['V03-evm-one-format-is-enough', 'src/probe/verdict.js', "if (t && p) return cell('check'", "if (t || p) return cell('check'"],
  ['V04-evm-typed-refusal-is-check', 'src/probe/verdict.js', "return cell('warning', `Signs personal_sign, but not", "return cell('check', `Signs personal_sign, but not"],
  ['V05-evm-personal-refusal-is-check', 'src/probe/verdict.js', "return cell('warning', `Signs the V1 typed data, but not", "return cell('check', `Signs the V1 typed data, but not"],
  ['V06-missing-repeat-counts', 'src/probe/verdict.js', 'if (second.sameAsFirst !== true) {', 'if (second.sameAsFirst === false) {'],
  ['V07-half-pair-measured', 'src/probe/verdict.js', 'if (!isVerified(first) || !isVerified(second)) continue;', 'if (!isVerified(first) && !isVerified(second)) continue;'],
  ['V08-unmeasured-determinism-is-check', 'src/probe/verdict.js', "if (measured === 0) return cell('not-yet-measured'", "if (measured === 0) return cell('check'"],
  ['V09-partly-readable-is-check', 'src/probe/verdict.js', "case 'partly': return cell('warning'", "case 'partly': return cell('check'"],
  ['V10-compare-unmeasured', 'src/probe/verdict.js', "if (b === 'not-yet-measured' || l === 'not-yet-measured') verdict = 'not-compared';", "if (b === 'not-yet-measured' && l === 'not-yet-measured') verdict = 'not-compared';"],
  ['V11-compare-inverted', 'src/probe/verdict.js', "else if (b === l) verdict = 'same';", "else if (b !== l) verdict = 'same';"],
  ['V12-differs-not-listed', 'src/probe/verdict.js', "if (verdict === 'differs') differs.push(cap);", ''],
  ['V13-old-device-is-check', 'src/probe/verdict.js', "if (c.value === 'check') return cell('warning', `${c.reason} But: ${meta.versionWarning}`);", "if (c.value === 'check') return c;"],
  ['V14-solana-wrong-beside-good-is-check', 'src/probe/verdict.js', "if (wrong) return cell('warning', `Signs ${formats}", "if (wrong) return cell('check', `Signs ${formats}"],
  ['V15-cardano-layout1-judged-by-text', 'src/probe/verdict.js', "const approval = text && isVerified(text) && text.layout === 2 ? text : by.get('probe:x-text') ?? text;", 'const approval = text;'],
  ['V16-refused-connect-is-check', 'src/probe/verdict.js', "if (c.outcome !== 'ok') return cell('cross', `The wallet did not connect", "if (c.outcome !== 'ok') return cell('check', `The wallet did not connect"],
  ['V17-6a80-hint-dropped', 'src/probe/verdict.js', "const hint = r?.status === '6a80' ?", "const hint = r?.status === 'never' ?"],
  // EVM checks (src/probe/evm.js).
  ['E01-no-contract-account-rule', 'src/probe/evm.js', 'if (sig.length > 65) return', 'if (sig.length > 650) return'],
  ['E02-no-candidates', 'src/probe/evm.js', 'checkEvmK256Signer(expected, digest, sig, others);', 'checkEvmK256Signer(expected, digest, sig, []);'],
  ['E03-every-pair-repeats', 'src/probe/evm.js', "y.sameAsFirst = sameCanonicalSignature('evm_k256', fromHex(x.signature), fromHex(y.signature));", 'y.sameAsFirst = true;'],
  ['E04-refused-asked-again', 'src/probe/evm.js', "if (first.outcome === 'refused') {", 'if (false) {'],
  ['E05-no-chainid-explanation', 'src/probe/evm.js', 'if (chainId !== undefined && chainId !== null) {\n      tries.push', 'if (false) {\n      tries.push'],
  ['E06-any-domain-accepted', 'src/probe/evm.js', "if (request?.type === 'typed-data') return typedDataDigest(checkEip712V1TypedData(request.typedData));", "if (request?.type === 'typed-data') return typedDataDigest(request.typedData);"],
  // Solana checks (src/probe/solana.js).
  ['S01-no-candidates', 'src/probe/solana.js', 'checkSolSignature(bytes, sig, keyText, others);', 'checkSolSignature(bytes, sig, keyText, []);'],
  ['S02-every-pair-repeats', 'src/probe/solana.js', 'b.sameAsFirst = equalBytes(canonicalEd25519Signature(fromHex(a.signature)), canonicalEd25519Signature(fromHex(b.signature)));', 'b.sameAsFirst = true;'],
  ['S03-named-families-probed', 'src/probe/solana.js', "if (source.kind === 'standard' && solWalletFamily(source.wallet.name) === 'other') {", "if (source.kind === 'standard') {"],
  // NEAR and Cardano checks.
  ['N01-no-callback-explanation', 'src/probe/near.js', 'if (pageUrl && verifyEd25519Strict(', 'if (false && verifyEd25519Strict('],
  ['N02-any-key', 'src/probe/near.js', 'if (identityKeyText && !equalBytes(pk, parseNearPublicKey(identityKeyText))) {', 'if (false) {'],
  ['C01-hashed-accepted', 'src/probe/cardano.js', "if (cose.hashed) return { outcome: 'wrong-signature'", "if (false) return { outcome: 'wrong-signature'"],
  ['C02-any-header', 'src/probe/cardano.js', "if (layout === null) return { outcome: 'wrong-signature'", "if (false) return { outcome: 'wrong-signature'"],
  ['C03-any-key', 'src/probe/cardano.js', 'if (identityKeyHex && toHex(key) !== identityKeyHex) return', 'if (false) return'],
  // The result file's self-check (src/probe/result.js).
  ['R01-steps-not-rechecked', 'src/probe/result.js', "if (!sameJson(strip(steps), strip(r.steps))) throw", 'if (false) throw'],
  ['R02-verdict-not-rechecked', 'src/probe/result.js', "if (!sameJson(cells, r.cells)) throw", 'if (false) throw'],
  // Detection's identity warnings.
  ['D01-shared-object-missed', 'src/detect/identity.js', 'if (group.length < 2) continue;', 'if (group.length < 3) continue;'],
  ['D02-rdns-mismatch-missed', 'src/detect/eip6963.js', 'if (byRdns && byName && byRdns !== byName) e.warnings.push', 'if (false) e.warnings.push'],
  ['D03-duplicate-name-missed', 'src/detect/wallet-standard.js', 'if (group.length > 1) for (const e of group) e.warnings.push', 'if (group.length > 2) for (const e of group) e.warnings.push'],
  ['D04-key-name-mismatch-missed', 'src/detect/cip30.js', 'if (byKey && byName && byKey !== byName) e.warnings.push', 'if (false) e.warnings.push'],
  // Version warnings (src/hw/versions.js).
  ['W01-comparison-inverted', 'src/hw/versions.js', 'for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];', 'for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];'],
  ['W02-ledger-warning-dropped', 'src/hw/versions.js', 'return b ? `The Ledger Solana app ${hw.appVersion} is older', 'return false ? `The Ledger Solana app ${hw.appVersion} is older'],
  ['W03-unreadable-version-silent', 'src/hw/versions.js', "if (b === null) return `The Trezor firmware version could not be read", "if (b === null) return null; if (false) return `The Trezor firmware version could not be read"],
  // The table model (src/data/model.js).
  ['M01-via-not-folded', 'src/data/model.js', "if (device && device.path === 'direct') device.via.push(v);", 'if (false) device.via.push(v);'],
  ['M02-legacy-not-last', 'src/data/model.js', 'f.software.sort(legacyLast);', ''],
  ['M03-missing-evidence-filled', 'src/data/model.js', "if (!e) problems.push(`row ${row.id}: ${cap} cites unknown evidence ${id}`);", ''],
];

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };

function copyTree(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d, new Set());
    else fs.copyFileSync(s, d);
  }
}

function runTests(work, timeoutMs = 300000) {
  const r = spawnSync(process.execPath, [path.join(work, 'web', 'test', 'run-unit.mjs'), '--out', path.join(work, 'web', '.test-build'), '--reporter', 'dot'], { cwd: path.join(work, 'web'), encoding: 'utf8', timeout: timeoutMs });
  return { status: r.status, signal: r.signal, tail: `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-6).join('\n') };
}

async function main() {
  const work = path.resolve(arg('--work', path.join(WEB, '.mutants')));
  const out = arg('--out', path.join(work, 'results.json'));
  const only = arg('--only', null)?.split(',');
  fs.rmSync(work, { recursive: true, force: true });
  copyTree(WEB, path.join(work, 'web'), new Set(['node_modules', 'dist', '.test-build', '.mutants']));
  fs.symlinkSync(path.join(WEB, 'node_modules'), path.join(work, 'web', 'node_modules'), 'dir');
  fs.symlinkSync(path.join(REPO, 'vendor'), path.join(work, 'vendor'), 'dir');
  fs.symlinkSync(path.join(REPO, 'data'), path.join(work, 'data'), 'dir');

  const base = runTests(work);
  if (base.status !== 0) { console.error(`the unmutated tests fail:\n${base.tail}`); process.exit(2); }
  const results = [];
  for (const [id, file, find, replace] of MUTANTS) {
    if (only && !only.includes(id)) continue;
    const p = path.join(work, 'web', file);
    const original = fs.readFileSync(p, 'utf8');
    const n = original.split(find).length - 1;
    if (n !== 1) { results.push({ id, file, status: 'invalid', detail: `the mutated text occurs ${n} times` }); console.log(`INVALID ${id} (${n} matches)`); continue; }
    fs.writeFileSync(p, original.replace(find, () => replace));
    const r = runTests(work);
    fs.writeFileSync(p, original);
    const killed = r.status !== 0;
    results.push({ id, file, status: killed ? 'killed' : 'survived', ...(killed ? {} : { detail: r.tail }) });
    console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${id}`);
  }
  const killed = results.filter((r) => r.status === 'killed').length;
  const summary = { total: results.length, killed, survived: results.filter((r) => r.status === 'survived').map((r) => r.id), invalid: results.filter((r) => r.status === 'invalid').map((r) => r.id), results };
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 1)}\n`);
  console.log(`${killed}/${results.length} mutants killed`);
  process.exit(killed === results.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main();
