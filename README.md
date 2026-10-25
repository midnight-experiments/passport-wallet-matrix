# Passport wallet matrix

A test page for **Midnight Passport** accounts controlled by wallets of other chains: EVM, Solana, NEAR and Cardano, software and hardware.

It shows:
- **a table of wallets**, each marked with a check, a warning or a cross per capability, with the reason and the evidence for each cell;
- **"test my wallet"**, which runs the same checks on the visitor's own wallet;
- **a Passport account** created and operated with any supported wallet: devices, grants, deposits, withdrawals and recovery.

**Status: in development.** Nothing here is ready to use yet.

## Stagenet only

The page targets Midnight's **stagenet** test network. Stagenet tokens have no value, and this page holds no real funds. Do not use wallets that hold real assets for testing unless you understand what you are signing.

- **The Cardano arm is a test arm.** It cannot yet bind a Cardano address to its key inside the circuit: Compact has no BLAKE2b. Treat it as test only.
- **Accounts created here keep a maintenance key in your browser.** Whoever holds that key can change the account's circuits, and so take its funds. It is acceptable only because stagenet funds are worthless.

## License

Apache-2.0, see [LICENSE](LICENSE). Vendored third-party sources keep their own licenses, recorded next to them.
