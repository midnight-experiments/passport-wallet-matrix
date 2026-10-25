# The key set

`manifest.json` lists every circuit a test account can carry, with the files a prover needs for it.
The local prover checks every downloaded file against it, and the sponsor checks every verifier key
a maintenance update inserts against it.

**Key set `cfe04de148883a6b86a4b792ed2159bd2663db9cb0c607930af2ee32926f029d`**: 36 circuits of the Passport `account` contract
(`vendor/passport/`, compiled by compactc 0.35.0 with `--feature-zkir-v3`):

| Group | Circuits | Prover keys |
|---|---|---|
| shared | 4: `deposit_shielded`, `deposit_unshielded`, `recover_finalise`, `recover_submit` | 0.06 GiB |
| `evm_k256` (EVM wallets, readable EIP-712) | 16 | 4.66 GiB |
| `sol_ed25519` (Solana wallets, readable messages) | 16 | 6.80 GiB |
| **total** | **36**, 13 of them at k = 18 | **11.52 GiB** (largest: `issue_grant_with_evm_k256`, 608 MiB) |

An account starts with the shared circuits and the creating wallet's arm (20 circuits). A family's
16 circuits are inserted, with a maintenance update, before the first device of that family is
used. The NEAR and Cardano arms will be added as a new key set.

## The manifest

| Member | Meaning |
|---|---|
| `format` | `passport-wallet-matrix-keyset/1` |
| `keySetId` | The SHA-256 of the canonical manifest (below) |
| `contract`, `source`, `compiler` | What was compiled, from which source commit, with which compiler and flags |
| `arms` | The arms whose circuits the set holds (the shared circuits are always in it) |
| `circuits[]` | Sorted by name. Each: `name`, `arm` (`shared` or an arm), `k`, `rows` (by `zkir-v3 mock-compile`), and `files` |
| `files.prover`, `files.verifier`, `files.bzkir`, `files.zkir` | Each: `name` (the file name, also the release asset's name), `sha256` (lowercase hex) and `size` (bytes). The proof server reads the prover key, the verifier key and the binary ZKIR (`.bzkir`); the JSON ZKIR (`.zkir`) is the same circuit in a readable form |

**The key-set id** is the lowercase hex SHA-256 of the canonical manifest: the manifest without its
`keySetId` member, serialised as JSON with every object's members sorted by name, arrays kept in
order, no whitespace, integers only, UTF-8. `node scripts/keyset-manifest.mjs check keyset/manifest.json`
recomputes it and checks the manifest's shape.

**Where the files are.** The compiler writes `keys/<circuit>.prover`, `keys/<circuit>.verifier`,
`zkir/<circuit>.bzkir` and `zkir/<circuit>.zkir`; a release holds the same files flat, under their
`name`. `node scripts/keyset-manifest.mjs check keyset/manifest.json <dir>` checks every file's size
and SHA-256 in either layout.

## Making it

```sh
bash scripts/compile-contract.sh --keys          # all 84 circuits of the account, with keys
node scripts/keyset-manifest.mjs build vendor/passport/contract/contracts/managed/account > keyset/manifest.json
node scripts/keyset-manifest.mjs check keyset/manifest.json vendor/passport/contract/contracts/managed/account
```

`build` also checks that every verifier key equals the one the generated module expects
(`expectedVk` in `contract/index.js`), and that every arm in the set carries the same operations.
The keys are deterministic: the same ZKIR and the same public parameters give the same files, so
anyone can rebuild them and compare.

## Excluded: the upstream arms

The contract also compiles the upstream authorisation arms `jubjub`, `k256` and `p256` (48
circuits). Test accounts never carry them, so they are not in the key set, and the sponsor pays
only for maintenance updates that insert keys listed in the manifest:

- `jubjub` (16): `activate_initial_device_with_jubjub`, `add_device_with_jubjub`, `append_inbox_with_jubjub`, `issue_grant_with_jubjub`, `publish_recovery_session_with_jubjub`, `recover_cancel_with_jubjub`, `remove_device_with_jubjub`, `revoke_all_grants_with_jubjub`, `revoke_grant_with_jubjub`, `rotate_enc_key_with_jubjub`, `withdraw_shielded_to_contract_with_grant_jubjub`, `withdraw_shielded_to_contract_with_jubjub`, `withdraw_shielded_with_grant_jubjub`, `withdraw_shielded_with_jubjub`, `withdraw_unshielded_with_grant_jubjub`, `withdraw_unshielded_with_jubjub`
- `k256` (16): `activate_initial_device_with_k256`, `add_device_with_k256`, `append_inbox_with_k256`, `issue_grant_with_k256`, `publish_recovery_session_with_k256`, `recover_cancel_with_k256`, `remove_device_with_k256`, `revoke_all_grants_with_k256`, `revoke_grant_with_k256`, `rotate_enc_key_with_k256`, `withdraw_shielded_to_contract_with_grant_k256`, `withdraw_shielded_to_contract_with_k256`, `withdraw_shielded_with_grant_k256`, `withdraw_shielded_with_k256`, `withdraw_unshielded_with_grant_k256`, `withdraw_unshielded_with_k256`
- `p256` (16): `activate_initial_device_with_p256`, `add_device_with_p256`, `append_inbox_with_p256`, `issue_grant_with_p256`, `publish_recovery_session_with_p256`, `recover_cancel_with_p256`, `remove_device_with_p256`, `revoke_all_grants_with_p256`, `revoke_grant_with_p256`, `rotate_enc_key_with_p256`, `withdraw_shielded_to_contract_with_grant_p256`, `withdraw_shielded_to_contract_with_p256`, `withdraw_shielded_with_grant_p256`, `withdraw_shielded_with_p256`, `withdraw_unshielded_with_grant_p256`, `withdraw_unshielded_with_p256`
