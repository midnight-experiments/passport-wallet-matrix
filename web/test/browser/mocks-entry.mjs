// Mock wallets for the browser tests, installed into the page before its
// own scripts run (Playwright addInitScript). They use the same software
// wallets as the Node tests, over public test keys.
import { evmProvider } from '../helpers/evm-wallet.mjs';
import { solWallet } from '../helpers/sol-wallet.mjs';
import { cip30Wallet } from '../helpers/cip30-wallet.mjs';
import { nearWallet } from '../helpers/near-wallet.mjs';

function announce(info, provider) {
  const send = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', send);
  send();
}

function registerStandard(wallet) {
  const cb = (api) => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', (ev) => cb(ev.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: cb }));
}

window.__installWalletMocks = (cfg = {}) => {
  const icon = 'data:image/svg+xml;base64,PHN2Zy8+';
  if (cfg.evm) {
    const genuine = evmProvider({ label: 'browser evm genuine', flags: { isMetaMask: true } });
    announce({ uuid: 'mock-metamask', name: 'MetaMask', rdns: 'io.metamask', icon }, genuine);
    if (cfg.impersonator) {
      // One extension that announces itself and also answers as MetaMask.
      const shared = evmProvider({ label: 'browser evm impersonator', flags: { isMetaMask: true } });
      announce({ uuid: 'mock-nufi', name: 'NUFI', rdns: 'io.nu.fi', icon }, shared);
      announce({ uuid: 'mock-fake-metamask', name: 'MetaMask', rdns: 'io.metamask', icon }, shared);
    }
    if (cfg.hedgedEvm) announce({ uuid: 'mock-hedged', name: 'Hedged Wallet', rdns: 'test.hedged', icon }, evmProvider({ label: 'browser evm hedged', mode: 'hedged' }));
  }
  if (cfg.solana) registerStandard(solWallet({ name: 'Phantom', label: 'browser sol phantom' }));
  if (cfg.cardano) window.cardano = { ...(window.cardano ?? {}), eternl: cip30Wallet({ name: 'eternl', label: 'browser ada eternl', layout: 1 }) };
  if (cfg.near) {
    // The object Sender injects, as the selector's Sender module uses it.
    const w = nearWallet({ label: 'browser near sender' });
    window.near = {
      isSender: true, callbacks: {}, isSignedIn: () => true, getAccountId: () => 'probe.testnet', on() {}, remove() {},
      signMessage: async (m) => ({ response: await w.signMessage(m) }),
    };
  }
};
