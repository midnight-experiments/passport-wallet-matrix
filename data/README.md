# Curated wallet data

The baseline the wallet table shows: which wallets, through which path, can do what for each Passport arm.

| File | What it holds |
|---|---|
| [`wallets.json`](wallets.json) | The data: families, capabilities, products, rows (one per product, connection path and family) with one cell per capability, and the evidence items the cells cite. |
| [`schema/wallet-matrix.schema.json`](schema/wallet-matrix.schema.json) | Its JSON Schema. |
| [`EVIDENCE.md`](EVIDENCE.md) | Where the evidence comes from, and which runs back each tested row. |
| [`scripts/validate.mjs`](scripts/validate.mjs) | The validator: the schema, the rules that span several objects, and a scan for strings that look like key material. |
| [`scripts/validate.test.mjs`](scripts/validate.test.mjs) | Its tests: the data passes, and each rule fails on a broken copy. |
| [`scripts/key-material-allowlist.json`](scripts/key-material-allowlist.json) | Public values that look like key material, each with the reason it is allowed. |

Validate before committing (Node 24; no dependencies, no network):

```sh
node data/scripts/validate.mjs
node --test data/scripts/validate.test.mjs
```

The validator checks, beyond the schema:
- every row has the five cells, and every cell a value, a reason and at least one evidence item that exists;
- every evidence item is cited, sources carry their URL, and runs carry the tested surface;
- ids are unique, and row ids follow `<product>--<family>` or `<product>--<family>--via-<host product>`;
- a "via" row is a hardware device reached through an existing direct software-wallet row of the same family;
- a row is marked legacy exactly when its product, or the wallet it goes through, is no longer active, and that lifecycle cites evidence;
- a tested row cites a workspace or emulator run, and an on-chain value other than "not yet measured" cites a workspace run;
- no string looks like key material: long hex or base58 runs, Ethereum addresses, Cardano bech32 strings, NEAR implicit or named accounts, base64 signatures.
