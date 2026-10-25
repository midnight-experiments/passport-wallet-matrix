# The wallet matrix page

A static page: the curated wallet table, the wallets detected in the visitor's browser, "test my wallet" and the direct hardware paths (Ledger, Trezor). It has no server code and stores nothing on a server: a visitor's result stays in the page and leaves it only as a file the visitor exports.

## Build and test

Node 22 or later. Dependencies install into `web/node_modules` (they need the network); the build and every test run offline.

```sh
cd web
npm ci
node build.mjs                 # the static site in web/dist (Cloudflare Pages)
node test/run-unit.mjs         # unit tests (node --test)
node test/browser/run.mjs      # the built page in headless Chromium (needs playwright-core's Chromium)
node test/mutants/run.mjs      # mutants of the verdict, detection and check rules
```

`build.mjs` refuses to finish when a file is 25 MiB or larger (Pages' limit), when the site has 20,000 files or more, when the output holds server code (`_worker.js`, `functions/`, `_routes.json`) or names the build directory. `dist/build-manifest.json` lists every file with its size and SHA-256.

The emulator tests (`test/emulator/`) drive the page's direct hardware code against the emulators, with public test seeds only:

- `ledger.mjs eth|sol <out>`: Speculos (`ghcr.io/ledgerhq/speculos:v0.27.1`, `--model flex`) running the Ethereum app 1.22.5 or the Solana app 1.16.0, built from Ledger's deployment tags (`flex_1.7.0_1.22.5_sdk_v27.1.1` of LedgerHQ/app-ethereum, `flex_1.6.1_1.16.0_sdk_v26.4.0` of LedgerHQ/app-solana) with Ledger's app builder. `SPECULOS` names its REST API.
- `trezor.mjs <out>`: inside the network namespace of a `ghcr.io/trezor/trezor-user-env` container (its controller on 127.0.0.1:9001, the emulator's UDP port 21324), started with `uv run --no-sync python src/main.py` so that it needs no network.

Bundle them first with `node test/build-tests.mjs`, then run `node .test-build/emulator/<file>.mjs`.

## Layout

| Path | What it holds |
|---|---|
| `src/main.js` | Entry point: the curated data, the detection listeners, the in-memory store, the shell. |
| `src/app/` | The shell (header, tabs, hash routing), the element builder, the store. |
| `src/sections/<name>/section.js` | One page section each: `table`, `detect`, `test`, `hardware`, `about`. |
| `src/data/model.js` | `data/wallets.json` resolved for display: rows per family, via rows folded under their device. |
| `src/detect/` | Detection: EIP-6963 and `window.ethereum`, the Wallet Standard, the NEAR wallet selector, CIP-30; provider-object identity. |
| `src/probe/` | "Test my wallet": one module per family, the verdict, the result file (export and self-checking import). |
| `src/probe/provisional.js` | Every NEAR and Cardano probe text and format choice. **Provisional** until the NEAR and Cardano arms are built. |
| `src/hw/` | The direct hardware paths: Ledger (WebHID and Ledger's app libraries, network services off) and Trezor (Trezor Connect), version warnings. |
| `src/vendor.js` | The Passport client modules the page uses, imported unchanged from `vendor/passport/contract/src/wallet/`. |
| `src/vendor-shims/` | What the bundler puts in place of the client's compiled-contract bindings and Node built-ins (see below). |
| `test/` | Unit tests, software test wallets (public test seeds only), the browser test, the emulator tests, the mutation runner. |

## Adding a section

A section is a folder `src/sections/<name>/` with a `section.js` whose default export is:

```js
export default {
  id: 'account',            // the route: #/account
  title: 'Account',         // the tab label
  order: 50,                // tab order (table 10, detect 20, test 30, hardware 40, about 90)
  mount(container, ctx) {}, // once, the first time the section is shown; may be async
  onShow(ctx) {},           // optional, every time it is shown
};
```

The bundler finds every section folder at build time (`esbuild-config.mjs`, `virtual:sections`); no existing file lists them, so a new section is a new folder. `ctx` holds `model` (the curated data), `store` (detected wallets and live results), `detector`, `page` (data version) and `go(id)`.

## The vendored client and its contract bindings

The EVM and Solana checks use the client's own modules: the formats each arm accepts, the probe texts, the canonical signatures and the signer check. Those modules import the compiled account contract (`./contract.js`) and two curve helpers of `@midnight-ntwrk/compact-runtime`. The page verifies signatures but never proves, so the bundler maps `./contract.js` to `src/vendor-shims/contract.js`, whose bindings throw when used, and the two helpers to a copy of their behaviour. A page section that needs the contract itself (account operations) changes that alias in `esbuild-config.mjs`.

## Trezor Connect manifest

Trezor Connect asks every page for a manifest: the application's name, its URL and a contact address Trezor uses to reach the maintainer (`TREZOR_MANIFEST` in `src/config.js`).
