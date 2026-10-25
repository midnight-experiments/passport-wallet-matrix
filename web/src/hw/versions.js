// Device software versions: parsing, comparison and the warnings the page
// shows below the versions the arms need.

import { MIN_VERSIONS } from '../config.js';

/** "1.16.0", "v2.12.5", "2.12.5-arm" -> [1, 16, 0]; anything else -> null. */
export function parseVersion(v) {
  const m = typeof v === 'string' ? /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `v` is older than `min`; null when `v` cannot be read. */
export function below(v, min) {
  const a = parseVersion(v), b = parseVersion(min);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * The warning for a device below what its arm needs, or null:
 *   - the Ledger Solana app before 1.16.0 expects the old off-chain layout;
 *   - Trezor firmware before 2.12.4 signs Solana off-chain messages in the
 *     old version 0.
 * An unreadable version is a warning too: the page cannot tell.
 */
export function versionWarning(hw) {
  if (!hw || hw.family !== 'solana') return null;
  if (hw.vendor === 'ledger') {
    const b = below(hw.appVersion, MIN_VERSIONS.ledgerSolanaApp);
    if (b === null) return `The Ledger Solana app version could not be read; the off-chain message v1 layout needs ${MIN_VERSIONS.ledgerSolanaApp} or later.`;
    return b ? `The Ledger Solana app ${hw.appVersion} is older than ${MIN_VERSIONS.ledgerSolanaApp}, which the off-chain message v1 layout needs; update the app in Ledger Wallet.` : null;
  }
  if (hw.vendor === 'trezor') {
    const b = below(hw.firmware, MIN_VERSIONS.trezorFirmwareSolana);
    if (b === null) return `The Trezor firmware version could not be read; Solana off-chain messages need firmware ${MIN_VERSIONS.trezorFirmwareSolana} or later.`;
    return b ? `Trezor firmware ${hw.firmware} is older than ${MIN_VERSIONS.trezorFirmwareSolana}, which signs Solana off-chain messages as version 1; update the firmware.` : null;
  }
  return null;
}
