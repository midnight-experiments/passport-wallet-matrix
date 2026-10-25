// PROVISIONAL: the NEAR and Cardano probe texts and format choices, in one
// place. Neither arm is built yet, so these follow the arms' approved design
// (NEP-413 with callbackUrl absent and fixed recipient and nonce recipes;
// CIP-8 through the reward address, unhashed, in protected-header layout 1
// or 2, with a fixed 32-byte prefix X before every layout-1 approval text)
// and change here, and only here, when the arms fix their final wording.
// Every result made with them is marked provisional.

import { sha256 } from '@noble/hashes/sha2.js';
import { utf8, concat, u32le, u64le, toHex } from '../bytes.js';
import { nearPublicKeyText } from './envelopes.js';

export const PROVISIONAL = true;
export const PROVISIONAL_NOTE = 'Provisional: the NEAR and Cardano arms are not built yet. These probes follow their approved design; the final texts may differ.';

/** A 32-byte tag: visible ASCII, zero-padded (the arms' pad32). */
export function pad32(text) {
  if (!/^[\x21-\x7e]+$/.test(text)) throw new Error('a tag is visible ASCII');
  const b = utf8(text);
  if (b.length > 32) throw new Error('a tag is at most 32 bytes');
  const out = new Uint8Array(32);
  out.set(b);
  return out;
}

/** One-line texts: fields joined by " | ", printable ASCII, no line feed, no
 *  leading, trailing or double space, so hardware shows them as text. */
export function oneLine(fields) {
  const s = fields.join(' | ');
  if (!/^[\x20-\x7e]+$/.test(s) || s.startsWith(' ') || s.endsWith(' ') || s.includes('  ')) {
    throw new Error('a one-line text is printable ASCII without leading, trailing or double spaces');
  }
  return s;
}

const NETWORK = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The device privacy-key request in the one-line form both arms use. */
export function blindRequestLine(walletText, network, accountIndex) {
  if (!NETWORK.test(network)) throw new Error('the network name is lower-case letters, digits and hyphens');
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 0xffffffff) throw new Error('the account index is 0 to 4294967295');
  return oneLine([
    'Midnight Passport account privacy key (v1)',
    `Network: ${network}`,
    `Wallet: ${walletText}`,
    `Account index: ${accountIndex}`,
    'Warning: this signature reveals the privacy key of this Passport account.',
    'Anyone who obtains it can link this wallet to that account.',
    'Sign it only in a Midnight Passport client you trust.',
    'It authorises nothing: no transfer, no new device, no grant.',
  ]);
}

const PROBE_LAST = 'It authorises nothing: it only tests which signing format this wallet signs.';

// ── NEAR (NEP-413) ──────────────────────────────────────────────────────────

/** The recipient of a blind request. */
export const NEAR_BLIND_RECIPIENT = 'midnight-passport';
/** The tag of the blind-request nonce (32 bytes). */
export const NEAR_BLIND_NONCE_TAG = 'midnight:account:nep413:blind:v1';
/** The tag of an approval's device nonce (32 bytes). */
export const NEAR_DEVICE_NONCE_TAG = 'midnight:account:nep413:nonce:v1';

/** The blind request's nonce: SHA-256(pad32(tag) || 00 (device) || u32le(account index)). */
export const nearBlindNonce = (accountIndex) => sha256(concat(pad32(NEAR_BLIND_NONCE_TAG), Uint8Array.of(0), u32le(accountIndex)));

/** An approval's nonce: SHA-256(pad32(tag) || account (32) || 00 || u64le(auth nonce)). */
export function nearDeviceNonce(account, authNonce) {
  if (!(account instanceof Uint8Array) || account.length !== 32) throw new Error('an account address is 32 bytes');
  return sha256(concat(pad32(NEAR_DEVICE_NONCE_TAG), account, Uint8Array.of(0), u64le(authNonce)));
}

/** The approval recipient: the account address as 64 lower-case hex digits. */
export const nearApprovalRecipient = (account) => toHex(account);

export const nearWalletText = (pk) => `NEAR public key ${nearPublicKeyText(pk)}`;

/** The NEP-413 payload of the blind request for a key. */
export function nearBlindPayload(pk, network, accountIndex) {
  return { message: blindRequestLine(nearWalletText(pk), network, accountIndex), recipient: NEAR_BLIND_RECIPIENT, nonce: nearBlindNonce(accountIndex), callbackUrl: null };
}

/** The approval-form probe: a one-line text that authorises nothing, signed
 *  with an approval's recipient and nonce recipe for a probe account that
 *  does not exist. */
export function nearProbePayload(probeAccount, probeNonce) {
  const message = oneLine([
    'Midnight Passport signing format check (near v1)',
    `Account: ${toHex(probeAccount)}`,
    `Nonce: ${toHex(probeNonce)}`,
    PROBE_LAST,
  ]);
  return { message, recipient: nearApprovalRecipient(probeAccount), nonce: nearDeviceNonce(probeAccount, 0n), callbackUrl: null };
}

// ── Cardano (CIP-8) ─────────────────────────────────────────────────────────

/** X: the fixed 32-byte prefix of every layout-1 approval payload. The
 *  wording is not final; it reads as the start of the one-line text. */
export const CARDANO_X = 'Midnight Passport, CIP-8 form | ';
if (utf8(CARDANO_X).length !== 32 || CARDANO_X.includes('\n')) throw new Error('X is 32 printable bytes without a line feed');

/** An approval text's length range, so both layouts' payload heads have the
 *  same form. */
export const CARDANO_TEXT_MIN = 256;
export const CARDANO_TEXT_MAX = 65503;

export const cardanoWalletText = (pk) => `Cardano key ${toHex(pk)}`;

/** The blind request's payload: the one-line request alone, never X. */
export const cardanoBlindPayload = (pk, network, accountIndex) => utf8(blindRequestLine(cardanoWalletText(pk), network, accountIndex));

/** The probe text: one line, at least 256 bytes, naming the reward address
 *  it is signed through. */
export function cardanoProbeText(rewardAddress, probeNonce) {
  const fields = [
    'Midnight Passport signing format check (cardano v1)',
    `Reward address: ${toHex(rewardAddress)}`,
    `Nonce: ${toHex(probeNonce)}`,
    'Signed through the reward address, payload unhashed',
    PROBE_LAST,
  ];
  const text = oneLine(fields);
  if (utf8(text).length < CARDANO_TEXT_MIN || utf8(text).length > CARDANO_TEXT_MAX) throw new Error('a Cardano approval text is 256 to 65,503 bytes');
  return text;
}

/** The approval payload for a layout: X || text (layout 1) or the text (layout 2). */
export function cardanoApprovalPayload(layout, text) {
  if (layout === 1) return concat(utf8(CARDANO_X), utf8(text));
  if (layout === 2) return utf8(text);
  throw new Error(`the Cardano arm has no layout ${layout}`);
}
