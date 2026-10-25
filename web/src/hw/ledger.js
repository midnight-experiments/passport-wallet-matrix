// Ledger, direct: the page talks to the device's apps through a Ledger
// transport (WebHID in the browser) and Ledger's own app libraries, with
// every Ledger network service switched off. The same functions run against
// any transport, so the emulator (Speculos) tests exercise this code.
//
//   - EVM: the Ethereum app signs the arm's V1 typed data with its EIP-712
//     support (it refuses typed data it cannot clear-sign with 0x6a80 unless
//     blind signing is on) and personal_sign.
//   - Solana: the Solana app signs the client's off-chain message v1
//     envelope as given; raw text is never sent (the app refuses it).

import { Buffer } from 'buffer';
import { HW_PATHS } from '../config.js';
import { fromHex, toHex } from '../bytes.js';

/** Ledger's app libraries with their network lookups disabled: no
 *  clear-signing metadata, token or plugin data is fetched. */
export const LEDGER_ETH_LOAD_CONFIG = Object.freeze({
  calServiceURL: null, cryptoassetsBaseURL: null, nftExplorerBaseURL: null, pluginBaseURL: null, extraPlugins: null,
});

/** The open app's name and version: the dashboard command GET APP AND
 *  VERSION (CLA b0, INS 01), which every app answers. */
export async function ledgerAppInfo(transport) {
  const r = await transport.send(0xb0, 0x01, 0x00, 0x00);
  const b = r instanceof Uint8Array ? r : new Uint8Array(r);
  if (b[0] !== 0x01) throw new Error('unexpected answer to GET APP AND VERSION');
  let i = 1;
  const nameLen = b[i++];
  const name = new TextDecoder().decode(b.subarray(i, i + nameLen)); i += nameLen;
  const versionLen = b[i++];
  const version = new TextDecoder().decode(b.subarray(i, i + versionLen));
  return { name, version };
}

/** The transport's device model, when it knows it (WebHID does). */
export const ledgerModel = (transport) => transport?.deviceModel?.productName ?? transport?.deviceModel?.id ?? null;

function requireApp(info, want) {
  if (info.name !== want) {
    const err = new Error(`open the ${want} app on the Ledger (the open app is ${info.name || 'the dashboard'})`);
    err.code = 'wrong-app';
    throw err;
  }
}

const sig65 = (r) => {
  const v = typeof r.v === 'number' ? r.v : parseInt(String(r.v), 16);
  return toHex(Uint8Array.of(...fromHex(String(r.r).padStart(64, '0')), ...fromHex(String(r.s).padStart(64, '0')), v < 27 ? v + 27 : v));
};

/** The EVM adapter of probe/evm.js over a Ledger transport and hw-app-eth. */
export function ledgerEvmAdapter({ transport, Eth, path = HW_PATHS.evm }) {
  let eth = null;
  const hardware = { vendor: 'ledger', family: 'evm', model: ledgerModel(transport), app: null, appVersion: null };
  return {
    hardware,
    async connect() {
      const info = await ledgerAppInfo(transport);
      hardware.app = info.name;
      hardware.appVersion = info.version;
      requireApp(info, 'Ethereum');
      eth = new Eth(transport, 'w0w', LEDGER_ETH_LOAD_CONFIG);
      const { address } = await eth.getAddress(path, false);
      return { address: fromHex(address), surface: { app: `Ethereum ${info.version}`, path } };
    },
    signTypedData: async (_address, typedData) => sig65(await eth.signEIP712Message(path, typedData)),
    personalSign: async (_address, message) => sig65(await eth.signPersonalMessage(path, toHex(message))),
  };
}

/** The hardware source of probe/solana.js over a Ledger transport and
 *  hw-app-solana. */
export async function ledgerSolanaSource({ transport, Solana, path = HW_PATHS.solana }) {
  const info = await ledgerAppInfo(transport);
  const hardware = { vendor: 'ledger', family: 'solana', model: ledgerModel(transport), app: info.name, appVersion: info.version };
  requireApp(info, 'Solana');
  const sol = new Solana(transport);
  try {
    const cfg = await sol.getAppConfiguration();
    if (cfg?.version) hardware.appVersion = String(cfg.version);
  } catch { /* GET APP AND VERSION already gave it */ }
  const { address } = await sol.getAddress(path);
  const publicKey = new Uint8Array(address);
  return {
    hardware,
    connectInfo: { surface: { app: `Solana ${hardware.appVersion}`, path } },
    source: {
      kind: 'hardware',
      family: 'ledger',
      publicKey,
      signOffchain: async (envelope) => {
        const { signature } = await sol.signOffchainMessage(path, Buffer.from(envelope));
        return new Uint8Array(signature);
      },
    },
  };
}

