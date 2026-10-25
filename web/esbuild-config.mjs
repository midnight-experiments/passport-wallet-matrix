// The bundler settings shared by the static build (build.mjs) and the test
// bundles (test/build-tests.mjs).
//
// Two plugins:
//   - vendorShims: the vendored Passport client imports its compiled-contract
//     bindings (`./contract.js`) and two curve helpers of
//     @midnight-ntwrk/compact-runtime. The page never proves, so both resolve
//     to the small modules in src/vendor-shims/.
//   - sections: `import sections from 'virtual:sections'` is every
//     src/sections/<name>/section.js, found at build time. A new page
//     section is a new folder; no existing file lists it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.dirname(WEB);
export const WALLET_DIR = path.join(REPO, 'vendor', 'passport', 'contract', 'src', 'wallet');
export const SECTIONS_DIR = path.join(WEB, 'src', 'sections');

export function vendorShims() {
  return {
    name: 'vendor-shims',
    setup(build) {
      // Compared by real path: the vendored tree may be reached through a link.
      const walletDir = fs.realpathSync(WALLET_DIR);
      build.onResolve({ filter: /^\.\/contract\.js$/ }, (args) =>
        fs.realpathSync(args.resolveDir) === walletDir ? { path: path.join(WEB, 'src', 'vendor-shims', 'contract.js') } : undefined);
      build.onResolve({ filter: /^@midnight-ntwrk\/compact-runtime$/ }, () =>
        ({ path: path.join(WEB, 'src', 'vendor-shims', 'compact-runtime.js') }));
    },
  };
}

/** The section folders, in name order (each section also has its own `order`). */
export function sectionFolders() {
  return fs.readdirSync(SECTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SECTIONS_DIR, d.name, 'section.js')))
    .map((d) => d.name)
    .sort();
}

export function sectionsPlugin() {
  return {
    name: 'sections',
    setup(build) {
      build.onResolve({ filter: /^virtual:sections$/ }, () => ({ path: 'sections', namespace: 'virtual-sections' }));
      build.onLoad({ filter: /.*/, namespace: 'virtual-sections' }, () => {
        const names = sectionFolders();
        const imports = names.map((n, i) => `import s${i} from './sections/${n}/section.js';`);
        return {
          contents: `${imports.join('\n')}\nexport default [${names.map((_, i) => `s${i}`).join(', ')}];\n`,
          resolveDir: path.join(WEB, 'src'),
          loader: 'js',
        };
      });
    },
  };
}

/** Options every bundle shares. */
export function commonOptions() {
  return {
    bundle: true,
    absWorkingDir: WEB,
    nodePaths: [path.join(WEB, 'node_modules')],
    plugins: [vendorShims(), sectionsPlugin()],
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
  };
}

/** The extra options of the browser bundle. */
export function browserOptions() {
  return {
    ...commonOptions(),
    platform: 'browser',
    format: 'esm',
    target: ['chrome120', 'firefox120', 'safari17', 'edge120'],
    inject: [path.join(WEB, 'src', 'vendor-shims', 'node-globals.js')],
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
    alias: {
      util: path.join(WEB, 'src', 'vendor-shims', 'util.js'),
      crypto: path.join(WEB, 'src', 'vendor-shims', 'node-builtins.js'),
      http: path.join(WEB, 'src', 'vendor-shims', 'node-builtins.js'),
      https: path.join(WEB, 'src', 'vendor-shims', 'node-builtins.js'),
    },
  };
}
