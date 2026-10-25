// Page-wide constants. Nothing here is secret: the page is static and public.

/** The network name written into the probe privacy-key requests. No Passport
 *  account lives on a network of this name, so a probe signature reveals the
 *  privacy key of no real account. It follows the client's network-name rule
 *  (lower-case letters, digits and hyphens). */
export const PROBE_NETWORK = 'wallet-matrix-probe';

/** The account index of the probe privacy-key requests. */
export const PROBE_ACCOUNT_INDEX = 0;

/** The exported live-result file: its format name and version. */
export const RESULT_FORMAT = 'passport-wallet-matrix/live-result';
export const RESULT_VERSION = 1;

/** The minimum device software the arms need. */
export const MIN_VERSIONS = Object.freeze({
  /** The Ledger Solana app signs the final off-chain message v1 layout from this version. */
  ledgerSolanaApp: '1.16.0',
  /** Trezor firmware signs Solana off-chain messages as version 1 from this version. */
  trezorFirmwareSolana: '2.12.4',
});

/** Trezor Connect asks every web page for a manifest naming the application
 *  and a contact address. The contact address is set before the page is
 *  deployed; Connect accepts the empty string. */
export const TREZOR_MANIFEST = Object.freeze({
  appName: 'Passport wallet matrix',
  appUrl: 'https://passport-wallet-matrix.pages.dev',
  email: '',
});

/** The BIP-44 paths the direct hardware paths use: the first account of each chain. */
export const HW_PATHS = Object.freeze({
  evm: "44'/60'/0'/0/0",
  solana: "44'/501'/0'/0'",
});
