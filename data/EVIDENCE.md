# Evidence index

What backs the curated wallet table in [`wallets.json`](wallets.json). Every cell of the table has a value, a reason and at least one evidence item; this page explains where those items come from and which runs back each **tested** row.

## Kinds of evidence

| Kind | What it is | What it carries |
|---|---|---|
| `workspace-test` | A run in this workspace: a real wallet signing Passport texts in the signing lab, or the Passport arms checking those signatures. | A description, the date and the tested surface (wallet, version when it was recorded, browser, network). Never a key, an address or a signature. |
| `emulator-vector` | A run on Trezor's emulator (`trezor-user-env`) or Ledger's emulator (Speculos), with public test seeds. | A description, the date, and the device, app or firmware version and emulator. |
| `primary-source` | A vendor document, source file, changelog or standard that this workspace read itself, either while testing or in the independent check of the research. | Its URL, and what it says. |
| `research` | A finding of the desk research of 2026-10-25, which read the primary source given. | That source's URL, and what was searched when nothing was found. |

The repository is public. The owner's own test wallets (Phantom, Backpack, Solflare, MetaMask, Rabby, Coinbase Wallet, Eternl, Lace, Meteor) appear only as descriptions of what was signed and what happened. Their keys, addresses, account names and signatures stay out of the repository, and `scripts/validate.mjs` refuses any string that looks like one.

## Values and states

- **check**: shown to hold for the row, by a test or emulator run here or by a primary source stating the capability.
- **warning**: holds with a caveat the reason states: a setting, a limit, a display problem, or one condition the arm needs that a source leaves unconfirmed.
- **cross**: shown not to hold.
- **not yet measured**: nothing decides it yet; not the same as unsupported. "Completes the operations on chain" is not yet measured on every row: only the local-stack runs and the stagenet session measure it.

Row states: **tested** (this workspace's runs), **documented** (a primary source confirms the capability), **unconfirmed** (no primary source found), **limited** (a source or a test shows a restriction) and **legacy** (sunset, superseded, ceasing or phased out, or reached through such a wallet; shown greyed and never recommended).

A row is one product, one connection path and one family. A wallet that signs for two families has two rows, because its results differ per family. Hardware has **direct** rows (the page talks to a Ledger or a Trezor itself) and **via** rows (the device behind a software wallet). Popularity belongs to the product: one product's installation count backs all of its rows and must never be added up across them.

## The workspace runs

The runs come from two studies in this workspace: the **signing-profile study** (workspace project 00075, October 2026), which built a local signing lab and the emulator harnesses, and the **signing-scheme refactor** (workspace project 00076), which rebuilt the EVM and Solana arms and re-checked the study's signatures against them.

| Evidence id | Run |
|---|---|
| `ws-eternl-ada-2026-10-20`, `ws-meteor-near-2026-10-20`, `ws-phantom-sol-2026-10-21`, `ws-backpack-sol-2026-10-21` | The owner's first wallet sessions in the signing lab (2026-10-20, with a second Solana pass on 2026-10-21). Every signature verified offline against the envelope the circuit rebuilds. |
| `ws-metamask-evm-2026-10-21`, `ws-backpack-evm-2026-10-21` | The owner's EIP-712 session (2026-10-21). |
| `ws-solflare-sol-2026-10-21`, `ws-rabby-evm-2026-10-21`, `ws-coinbase-evm-2026-10-21`, `ws-lace-ada-2026-10-21` | The owner's second round (2026-10-21). MyNearWallet was skipped in this round because it sunsets on 2026-10-31. |
| `ws-mynearwallet-lab-2026-10-21` | The lab's MyNearWallet adapter, run against a simulated wallet response. No real MyNearWallet signature exists. |
| `ws-evm-determinism-2026-09-04` | A determinism spike from an earlier project: one EIP-712 test message, without chainId, signed by MetaMask, Phantom (EVM) and a software wallet with the same key. |
| `ws-evm-arm-2026-10-23`, `ws-sol-arm-2026-10-23` | The refactored EVM and Solana arms checking the real-wallet signatures, and proving the EVM ones at a local proof server. |
| `emu-*` | The study's emulator runs: Trezor Safe 5 (firmware 2.12.5) and Ledger Flex and Nano S Plus on Speculos v0.27.1, with the Ethereum 1.22.5, Solana 1.16.0, NEAR 2.5.0 and Cardano 8.0.9 apps (and Cardano 7.3.1 for comparison). The Solana emulator signatures are committed to the refactored arm as frozen test vectors (`emu-sol-fixtures-2026-10-23`). |

## Tested rows

### EVM

- **MetaMask** (`metamask--evm`). The owner signed `rotate_enc_key` and `issue_grant` as EIP-712 V1 typed data on MetaMask 13.52.0 (2026-10-21). Both verified, and the refactored EVM arm's circuits accepted and proved them (2026-10-23). MetaMask refused a request carrying a chainId other than its active network, which the arm never sends. Its display shows labelled fields and the effect text but also names its active network, so the readable cell is a warning. Determinism rests on the 2026-09-04 spike, because the Passport session signed each digest once.
- **Phantom (EVM)** (`phantom--evm`). Only the 2026-09-04 determinism spike: Phantom signed an EIP-712 test message without chainId, byte-identical to MetaMask and a software wallet. No Passport V1 approval has been signed with it, so its format cell is a warning and its display cell is not yet measured.
- **Coinbase Wallet** (`coinbase--evm`). V1, V2 and `personal_sign` signed on 2026-10-21 with a key account (every signature recovered to the connected account). The V1 signature passed the arm's circuits. The display and determinism were not recorded.
- **Rabby** (`rabby--evm`). Rabby 0.94.12 signed V1 and `personal_sign` through EIP-6963 and through `window.ethereum`. The same V1 digest gave the same signature through both entries, which backs the determinism check (one session). It labels Passport typed data "Unknown Signature Type", shows raw JSON and "Chain: Ethereum": a warning.
- **Backpack (EVM)** (`backpack--evm`). V0, V1 and V2 signed with no chain check; V1 passed the arm's circuits. It shows raw JSON: a warning.
- **Ledger** (`ledger--evm`). On Speculos, the Ethereum app 1.22.5 refuses the arm's V1 typed data by default (`0x6a80`) and signs it only with blind signing switched on, after a loss-of-funds warning: a warning. Metadata signed with the app's test key makes it clear-sign, but production devices accept only Ledger-signed metadata, and Ledger has no entry for this domain. `personal_sign` works by default.
- **Trezor** (`trezor--evm`). On the Safe 5 emulator (firmware 2.12.5), the arm's V1 typed data is shown field by field, whole, and signed; every repeat is identical.

### Solana

- **Phantom** (`phantom--solana`). Raw messages signed through the injected provider and Wallet Standard on 2026-10-20 and 2026-10-21, identical over five signatures and two sessions, shown with their line breaks. Phantom refuses off-chain message v1 every time, so the client asks it for raw. The refactored arm prefixes raw messages with a fixed 50-byte head; Phantom's real signatures predate it, so the same texts were re-checked with software test keys and the owner re-signs with Phantom later.
- **Backpack** (`backpack--solana`). Raw and off-chain message v1 signed, including through its own `solana:signOffchainMessage`; the off-chain signatures verify on the refactored arm's off-chain path. It decodes the envelope and shows the text with its line breaks, the best Solana display seen, but its optional 24-hour auto-approve would sign unseen: a warning. With Phantom also installed, it answered three requests made through Phantom's Wallet Standard entry with its own key; the page's signer check refuses such answers before proving.
- **Solflare** (`solflare--solana`). Raw and off-chain message v1 through its own `signOffchainMessage` (2026-10-21); the off-chain signature verifies on the arm's off-chain path. Shown cleanly through its own method.
- **Ledger** (`ledger--solana`) and **Trezor** (`trezor--solana`). Both sign Passport texts only as off-chain message v1, with byte-identical results, and refuse raw text (Ledger `0x6a81`). The Ledger app needs 1.16.0 or later; Trezor firmware needs 2.12.4 or later. Ledger shows the text with its line breaks; Trezor shows the first lines and offers "Confirm without review": a warning. Their signatures are frozen test vectors of the refactored arm, and its fixture suite passes on them.

### NEAR

- **Meteor** (`meteor--near`). NEP-413 through the NEAR wallet selector on testnet (2026-10-20), for texts up to 1,690 bytes, with `callbackUrl` absent as the NEAR arm requires; identical on repeat. Meteor's own SDK signs a hidden `callbackUrl`, which changes the blind, so the page uses the selector. It collapses line breaks and hides the recipient and nonce: a warning. The NEAR arm itself is not built yet.
- **Ledger** (`ledger--near`). The NEAR app 2.5.0 on Speculos signs NEP-413 over the whole message but shows only its first 400 bytes: a warning.

### Cardano

The Cardano arm is test only: it cannot bind an address to its key inside the circuit.

- **Eternl** (`eternl--cardano`). CIP-30 `signData` on preprod (2026-10-20): header layout 1, payload unhashed, the reward address signing with the stake key. Identical on repeat; the stake-key blind was reproduced over two sessions, across a browser restart. It collapses line breaks: a warning.
- **Lace** (`lace--cardano`). `issue_grant` (1,690 bytes) through the reward address on preprod (2026-10-21): header layout 2, unhashed. One signature per address, so determinism and the display are not yet measured.
- **Ledger** (`ledger--cardano`) and **Trezor** (`trezor--cardano`). Both sign CIP-8 unhashed through the reward address on the emulators. Both show multi-line text as hex: a warning. The Ledger Cardano app 7.x refuses unhashed texts over 198 bytes.

## Hardware through software wallets

The via rows rest on the research: each host's documentation of the device, and the device's own direct-path evidence. None has been tested through its host yet, so most cells are "not yet measured". Three carry a sourced verdict, and one a known conflict between sources:
- **Ledger via Eternl** (warning): Eternl asks the Ledger to hash long payloads (`hashed: true`), which the Cardano arm refuses.
- **Ledger via Lace** (cross): Lace asks the Ledger to hash payloads of 198 bytes and more (read in Lace's source), and every Passport approval is longer.
- **Trezor via NUFI, Solana** (cross): NUFI's own guide says message signing is not supported on that route.
- **Ledger and Trezor via MetaMask** (not yet measured): MetaMask's guide limits hardware data signing to `personal_sign`, but its keyring source implements typed data.

## The research

The researched rows come from a desk research of 2026-10-25 (live web search; every verdict links a primary source). An independent check re-read 14 of its key claims from their sources: 9 verified, 4 partly verified, 1 a correct quote of a page that is out of date, none contradicted. The table applies its corrections:
- Chrome Web Store counts: Eternl 90,000 and Meteor 30,000, not the first reading's 100,000 and 20,000.
- MetaMask's "hardware signs data with `personal_sign` only" is out of date: its keyrings implement typed data.
- Lace's FAQ on Ledger and the dApp connector is out of date: Lace 1.5 added Ledger CIP-30 transaction signing. Hardware `signData` through the connector is still undocumented.
- The Ledger Solana app signs the final off-chain v1 layout from 1.16.0; Ledger Live listed 1.17.1 for the Flex on 2026-09-30.
- NUFI's wallet emulation also covers Xverse and Flow Wallet.

Items the check re-read are `primary-source`; the rest are `research`.

## Updating the data

- Add a run as a new evidence item, cite it from the cells it decides, and change their values and reasons.
- A visitor's exported "test my wallet" result becomes evidence only after review, as a `workspace-test` description without key material.
- Run `node data/scripts/validate.mjs` and `node --test data/scripts/validate.test.mjs` before committing; both run offline.
