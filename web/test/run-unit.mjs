// Bundles and runs the unit tests: node --test over test/unit/*.test.mjs.
//   node test/run-unit.mjs [--out <dir>] [--reporter <name>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WEB } from '../esbuild-config.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(WEB, '.test-build');
const repArg = process.argv.indexOf('--reporter');
const reporter = repArg > 0 ? process.argv[repArg + 1] : 'spec';

const b = spawnSync(process.execPath, [path.join(WEB, 'test', 'build-tests.mjs'), '--out', OUT], { stdio: 'inherit' });
if (b.status !== 0) process.exit(b.status ?? 1);
const files = fs.readdirSync(path.join(OUT, 'unit')).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(OUT, 'unit', f)).sort();
const r = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, '--test-concurrency=1', ...files], { stdio: 'inherit', env: { ...process.env, PWM_WEB: WEB } });
process.exit(r.status ?? 1);
