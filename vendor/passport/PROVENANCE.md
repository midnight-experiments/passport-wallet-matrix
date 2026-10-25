# Provenance of `vendor/passport/`

These files are copied, unchanged, from the Midnight Passport account contract and its client. They
are the account contract with two wallet authorisation arms: `evm_k256` (readable EIP-712 approvals
from EVM wallets) and `sol_ed25519` (readable Ed25519 messages from Solana wallets).

| Item | Value |
|---|---|
| Origin repository | [midnightntwrk/passport](https://github.com/midnightntwrk/passport) |
| Upstream base | `main` @ `cd346383c89b9ac3b328122b0053d66a2ce6215e` (2026-10-19), the base of both drafts below |
| Arms | draft [#188](https://github.com/midnightntwrk/passport/pull/188) (`evm_k256`; GitHub head `dd2cd1394598579b844ab992e5139675df1f28ae`) and draft [#189](https://github.com/midnightntwrk/passport/pull/189) (`sol_ed25519`; GitHub head `7c3716b20dfe7263434138759fee1d0a730b6c45`), merged locally |
| Source commit | `048174b0911ffb7cca8fb0c082f01ee746ed16e3` (2026-10-25 06:22 -0300), branch `wallet-arms-integration`. It merges #188's branch at `b98b9915e3ca11f769837ba9d63f95276c9c2130` (16 commits past the GitHub head) and #189's at `1e6e70218ac968f3813a331318f305d09c75c703` (14 commits past it). Those later commits and the merge are not published yet; they are to be pushed to the two drafts |
| Exported | 2026-10-25, with `git archive 048174b0911ffb7cca8fb0c082f01ee746ed16e3 <paths>`; every file's git blob id was checked equal to the commit's |
| License | **Apache-2.0**: `LICENCE` below, byte-identical to upstream `main`'s `LICENCE` (GitHub reports the repository's license as `apache-2.0`). Upstream has no `NOTICE` file |
| Files | 40: the license, 13 contract sources, 24 client sources, `contract/package.json`, `contract/tsconfig.json` |

## What is included

- `LICENCE`: the origin's license, kept beside the sources.
- `contract/contracts/`: `account.compact` and everything it includes or imports: `webauthn.compact`,
  `account-p256.compact`, `account-evm-k256.compact`, `account-sol-ed25519.compact` and the eight
  modules in `modules/`.
- `contract/src/`: the client, `index.ts` and all of `wallet/` (the arm registry, the format choice,
  the signer check, the blind restore, the wave deploy and the account operations). `wallet/contract.ts`
  imports the generated module from `../../contracts/managed/account/contract/index.js`, so the layout
  is kept as upstream's: `scripts/compile-contract.sh` writes the build there.
- `contract/package.json` (the dependency versions the client was written against; its `scripts`
  refer to upstream files that are not vendored) and `contract/tsconfig.json`.

## What is left out

- Build output (`contracts/managed/`) and keys: they are rebuilt from these sources with the pinned
  compiler (`scripts/compile-contract.sh`) and published as release assets (`keyset/`).
- The other contracts (`control`, `faucet` and the `probe-*` contracts), the tests (`src/tests/`),
  the Node test harness (`src/node/`: a wallet-SDK wallet and the control and faucet contracts), the
  run records and arm evidence (`contract/evidence/`), the measurements and design notes, and the
  rest of the upstream repository (docs, research, site, experiments). The client imports none of them.
- `contract/package-lock.json`: compiling the contract needs no package; the page pins its own
  dependencies.
- No test-account secret, no key and no signature of a real wallet is included.

## Rules for changing this folder

- The files stay byte-identical to the source commit. A newer source is vendored as a whole, with
  this file's table and list updated in the same commit.
- `scripts/check-vendor.sh` checks the folder against the list below: a changed, missing or
  unlisted file fails it, and `scripts/compile-contract.sh` runs it before every build.

## Per-file SHA-256

<!-- sha256sum -->
```
0c7c97148a15426f4ce174dac138b91f67ecf20192dd40224aef58b9ccf1714d  LICENCE
6a2b9ab702a16dfef52112cc1005cb9c930c98519b708b5cf6b459892566ed26  contract/contracts/account-evm-k256.compact
50aca789d611fab99292725a64a8231e0a6509ca726fdb1e23babf96e0ad9fd4  contract/contracts/account-p256.compact
b12fdca5796363a60225f2ca3d99f5e7a6f72135627958c15ceac14ece9da56c  contract/contracts/account-sol-ed25519.compact
d58bc86754ff1943614519981129cc2d4c16ea96e1634a4314919b3aa75f8a0e  contract/contracts/account.compact
56abb7240740c33aee825f39bf93570fed069396f81a9e7d2294611052603bb1  contract/contracts/modules/Ed25519Core.compact
6cd4c5f74e4362ec086855846869a17c89652c18ce5a9a99fd94908f03f7565e  contract/contracts/modules/Eip712V1.compact
e618baf1460ab5ec884fd4411af2b8a0f6b94b79a443cc7e866f56b30ee7d8b8  contract/contracts/modules/EvmIdentity.compact
9d9ae26634aacb8259bdd12711bd82c51fbe838066f8e3cfcedb32603330ef66  contract/contracts/modules/EvmK256.compact
30439fe0f56d20c6e1455bc5c7b4431d3d645450ed7dede84d5fe614156d72e7  contract/contracts/modules/K256Core.compact
73a70c258b990118ea21b73451b4861089e579a13d478d550e5ac42b19d75587  contract/contracts/modules/SolanaFormats.compact
04419c86aa5052745718a0982c47ab8819dabd05b206a72dee65adb6f31da707  contract/contracts/modules/WalletArmDescriptors.compact
61481b660bac7fe25cfe5740637f505069b371ef9904593d3f412f5d1418397a  contract/contracts/modules/WalletArmRendering.compact
04e84a53c6ffd2701a7f07820ef6becf2ffee06e05de9ca9dfd9e2b33ce7dedb  contract/contracts/webauthn.compact
2edb5421cff72137d79afcd4100079689aeb9d53b9c5929f2b51cc772325b692  contract/package.json
fceb17b29b2a1ac75305ce74ea9891de8f9f565527fda78e733bfd262e1cb5db  contract/src/index.ts
4280bbffe324e4da18f22c33d50169d8b5261fefec389697d2868706c7a53bc7  contract/src/wallet/account.ts
f5177cf9aa29ccf2e3f21c98cc5b5f3436716f0b51667226c321ea4c532b9f7c  contract/src/wallet/blind.ts
d4b40b8562ea645e38f4ccd24d6277dd281f14cefc70f058f498846984d1b2b0  contract/src/wallet/capture.ts
1f7afef8d4fa921d5f2431e61d8cec7570c242c130435a4bfd894b88183eea66  contract/src/wallet/contract.ts
60b091b82534b6e46e411284289340f82aaf9a77edf35ade4f469f825cb32acc  contract/src/wallet/descriptors.ts
d2ce9ce8ede982fbcac1aa91c295f34925e7e40201cb1c2d95a24f371730bf9c  contract/src/wallet/discovery.ts
079a39e7a78bcc7ec8add31ff5c5ac634e1961aced6caf01d91e08c1cf44bd69  contract/src/wallet/evm-k256-codec.ts
dbe1d25a110bbb328542e27ab3e89fe88582fe12786bd817b70356e0295c577c  contract/src/wallet/evm-k256-hints.ts
606025c12369015fcf20660e1e10cd9188939340677914cad66e006c78f00c34  contract/src/wallet/hex.ts
3c4bce6dd5e92eda4b8e2dda15fc4aef91003300c4296cb3794a1d8d695a5922  contract/src/wallet/inbox.ts
c98ad9cf1dd6ba1116111cc394ad9bd3511f3121f3f95d8ad9f1c8019c0c2a77  contract/src/wallet/labels.ts
4367c68b64d12ab7216e4c9aabe4686a65835ca873b4f1d4842ff62398180389  contract/src/wallet/recovery-gate.ts
8a92114a7d9c3e1b4f5188b8d660d1459c58b70b715992c4b5d144a1bf7baf2c  contract/src/wallet/recovery.ts
9803d5eeed1d99ff9b2fe3a6d62b2952d05feb98772e6c2e0529b7283234b4d8  contract/src/wallet/rendering.ts
df866f4d1276c93c43970b6cc86f880be279224ea3feaa42a2370f7fc95c433b  contract/src/wallet/signer-evm-k256.ts
5a2b9e646283425fefcdf2f70dd058976aa772b1c11a10522df0eaa059787c76  contract/src/wallet/signer-p256.ts
f66353c352cf66a540f61a110e73d77281604401208e693b1b7a0c9843df5b78  contract/src/wallet/signer-sol-ed25519.ts
bcf67515ec951682453329af548d397597050000358f30250cf3037688b97762  contract/src/wallet/signer.ts
2ae27b1dea6eb7be34c286f5ac392757be4ca08977159821dbf41ad2c318893e  contract/src/wallet/sol-ed25519-message.ts
9c87da716c2bb150c677acb6d7ef391f8b89cab3e07c29d2ad19754118075143  contract/src/wallet/sol-ed25519-wallet.ts
db8dfd1df49bb1f5f49a475209109ea2b587d787f5dbfcbe154c841519f2417c  contract/src/wallet/wave-deploy.ts
b49c26fcb9a405885e18c44e40e94b20ca7c2c18c638344557b7a5b18602c108  contract/src/wallet/webauthn.ts
7eadb415ac132fa06670633539573d83904e3d6b126cda020b7244cb2d2f89c0  contract/src/wallet/witnesses.ts
cc8456ced37330404eb2389e718f877db048f81c435b1c9d120797ad624ce3ab  contract/tsconfig.json
```
