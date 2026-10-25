// One direct-hardware test: the device's family adapter, the family's test
// and the result, compared with the curated direct row of that device. The
// page passes a WebHID transport or Trezor Connect for the browser; the
// emulator tests pass a Speculos transport or Connect for Node.

import { ledgerEvmAdapter, ledgerSolanaSource } from './ledger.js';
import { trezorEvmAdapter, trezorSolanaSource } from './trezor.js';
import { testEvm } from '../probe/evm.js';
import { testSolana } from '../probe/solana.js';
import { makeResult } from '../probe/result.js';
import { detectedEntry } from '../detect/common.js';
import { surfaceOf } from '../probe/run.js';

/** Runs one direct-hardware test; returns the detected entry and the result. */
export async function runHardwareTest({ vendor, family, transport, TC, Eth, Solana, model }) {
  let test, hardware;
  if (vendor === 'ledger' && family === 'evm') {
    const a = ledgerEvmAdapter({ transport, Eth });
    test = await testEvm(a);
    hardware = a.hardware;
  } else if (vendor === 'ledger' && family === 'solana') {
    const s = await ledgerSolanaSource({ transport, Solana });
    hardware = s.hardware;
    test = await testSolana(s.source, { connectInfo: s.connectInfo });
  } else if (vendor === 'trezor' && family === 'evm') {
    const a = trezorEvmAdapter({ TC });
    test = await testEvm(a);
    hardware = a.hardware;
  } else if (vendor === 'trezor' && family === 'solana') {
    const s = await trezorSolanaSource({ TC });
    hardware = s.hardware;
    test = await testSolana(s.source, { connectInfo: s.connectInfo });
  } else {
    throw new Error(`no direct path for ${vendor} ${family}`);
  }
  const productId = vendor;
  const name = vendor === 'ledger' ? 'Ledger (direct)' : 'Trezor (direct)';
  const standard = vendor === 'ledger' ? 'Ledger direct (WebHID)' : 'Trezor direct (Trezor Connect)';
  const d = detectedEntry({ key: `hw:${vendor}:${family}`, family, standard, name, productId, productBy: 'path' }, null);
  return {
    detected: d,
    result: makeResult({
      family, test, wallet: { standard, reported: { key: d.key, name, standard, productId, productBy: 'path' }, surface: surfaceOf(d, null), hardware },
      baselineView: model.views.get(`${vendor}--${family}`) ?? null,
    }),
  };
}

