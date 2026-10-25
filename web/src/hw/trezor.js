// Trezor, direct: the page reaches the device through Trezor Connect, which
// serves web pages (in the browser, @trezor/connect-web opens Trezor's own
// Connect window; the emulator tests use the same calls through
// @trezor/connect). Every call's answer is unwrapped here and checked by the
// family's probe like any other wallet's.
//   - EVM: the arm's V1 typed data through ethereumSignTypedData (the whole
//     typed data, with the two hashes for a Model One), and personal_sign
//     through ethereumSignMessage;
//   - Solana: solanaSignMessage, which builds the off-chain message v1 from
//     the text (passed as text, not hex) and the signing key; the signed
//     bytes it reports must be the client's envelope.

import { HW_PATHS } from '../config.js';
import { fromHex, toHex } from '../bytes.js';
import { domainSeparator, hashStruct } from '../vendor.js';

/** A Connect answer's payload, or an error carrying Connect's code. */
export function unwrap(res) {
  if (res?.success === true) return res.payload;
  const err = new Error(res?.payload?.error ?? 'Trezor Connect returned no answer');
  if (res?.payload?.code) err.code = res.payload.code;
  throw err;
}

/** The device's model and firmware version. */
export async function trezorFeatures(TC) {
  const f = unwrap(await TC.getFeatures());
  return {
    model: f.internal_model ?? f.model ?? null,
    modelName: f.model ?? null,
    firmware: [f.major_version, f.minor_version, f.patch_version].every((x) => typeof x === 'number') ? `${f.major_version}.${f.minor_version}.${f.patch_version}` : null,
  };
}

const hexSig = (s) => String(s).replace(/^0x/i, '').toLowerCase();

/** The EVM adapter of probe/evm.js over a Trezor Connect object. */
export function trezorEvmAdapter({ TC, path = HW_PATHS.evm }) {
  const hardware = { vendor: 'trezor', family: 'evm', model: null, firmware: null };
  return {
    hardware,
    async connect() {
      const f = await trezorFeatures(TC);
      Object.assign(hardware, f);
      const { address } = unwrap(await TC.ethereumGetAddress({ path: `m/${path}`, showOnTrezor: false }));
      return { address: fromHex(address), surface: { firmware: f.firmware, model: f.model, path } };
    },
    async signTypedData(_address, typedData) {
      const { EIP712Domain, ...types } = typedData.types;
      const r = unwrap(await TC.ethereumSignTypedData({
        path: `m/${path}`,
        data: typedData,
        metamask_v4_compat: true,
        domain_separator_hash: toHex(domainSeparator(typedData.domain)),
        message_hash: toHex(hashStruct(typedData.primaryType, typedData.message, { EIP712Domain, ...types })),
      }));
      return hexSig(r.signature);
    },
    async personalSign(_address, message) {
      const r = unwrap(await TC.ethereumSignMessage({ path: `m/${path}`, message: toHex(message), hex: true }));
      return hexSig(r.signature);
    },
  };
}

/** The hardware source of probe/solana.js over a Trezor Connect object. */
export async function trezorSolanaSource({ TC, path = HW_PATHS.solana }) {
  const f = await trezorFeatures(TC);
  const hardware = { vendor: 'trezor', family: 'solana', ...f };
  const pk = unwrap(await TC.solanaGetPublicKey({ path: `m/${path}`, showOnTrezor: false }));
  const publicKey = fromHex(pk.publicKey);
  return {
    hardware,
    connectInfo: { surface: { firmware: f.firmware, model: f.model, path } },
    source: {
      kind: 'hardware',
      family: 'trezor',
      publicKey,
      // Connect takes the message as text, which the device signs as UTF-8
      // after the off-chain v1 head it builds; the client's texts are ASCII.
      signOffchain: async (_envelope, text) => {
        const r = unwrap(await TC.solanaSignMessage({ path: `m/${path}`, message: new TextDecoder('utf-8', { fatal: true }).decode(text) }));
        return { signature: fromHex(r.signature), ...(r.signedData ? { signed: fromHex(r.signedData) } : {}) };
      },
    },
  };
}
