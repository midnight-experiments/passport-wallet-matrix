// The checks a static site must pass before it can go to Cloudflare Pages:
//   - every file under 25 MiB (Pages refuses larger files) and fewer than
//     20,000 files;
//   - no server code: no _worker.js, no functions/ directory, no _routes.json;
//   - no file naming one of the given host paths (a build directory leaking
//     into a public site).
// Returns the file list with sizes and SHA-256, and the problems found.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 20000;

export function checkSite(dir, { hostPaths = [] } = {}) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
  const problems = [];
  for (const bad of ['_worker.js', '_routes.json']) if (fs.existsSync(path.join(dir, bad))) problems.push(`server code: ${bad}`);
  if (fs.existsSync(path.join(dir, 'functions'))) problems.push('server code: functions/');
  if (files.length >= MAX_FILES) problems.push(`${files.length} files: Pages allows fewer than ${MAX_FILES}`);
  const list = [];
  for (const f of files.sort()) {
    const buf = fs.readFileSync(f);
    if (buf.length >= MAX_FILE_BYTES) problems.push(`${rel(f)} is ${buf.length} bytes: Pages refuses files of 25 MiB or more`);
    const text = buf.toString('latin1');
    for (const hp of hostPaths) if (hp && text.includes(hp)) problems.push(`${rel(f)} names the build directory ${hp}`);
    list.push({ path: rel(f), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  }
  return { list, problems, bytes: list.reduce((n, f) => n + f.bytes, 0) };
}
