// The names, rdns values, CIP-30 keys and NEAR selector modules by which
// wallets report themselves, mapped to the curated products. A match only
// says which curated row a detected wallet's own report points to: a wallet
// can report any name, so the page shows the match as "reported by the
// wallet" and never as that row's result.

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const EVM_RDNS = Object.freeze({
  'io.metamask': 'metamask', 'io.metamask.flask': 'metamask', 'io.metamask.mobile': 'metamask',
  'app.phantom': 'phantom',
  'com.coinbase.wallet': 'coinbase',
  'com.trustwallet.app': 'trust',
  'com.okex.wallet': 'okx',
  'io.rabby': 'rabby',
  'app.backpack': 'backpack',
  'me.rainbow': 'rainbow',
  'so.onekey.app.wallet': 'onekey-app',
});

export const NAMES = Object.freeze({
  'metamask': 'metamask', 'metamask flask': 'metamask',
  'phantom': 'phantom',
  'coinbase wallet': 'coinbase', 'coinbase': 'coinbase', 'base': 'coinbase', 'base app': 'coinbase',
  'trust wallet': 'trust', 'trust': 'trust',
  'okx wallet': 'okx', 'okx': 'okx',
  'rabby wallet': 'rabby', 'rabby': 'rabby',
  'backpack': 'backpack',
  'rainbow': 'rainbow',
  'onekey': 'onekey-app', 'onekey app': 'onekey-app',
  'solflare': 'solflare',
  'nightly': 'nightly',
  'jupiter': 'jupiter', 'jupiter wallet': 'jupiter',
  'nufi': 'nufi',
  'eternl': 'eternl',
  'lace': 'lace',
  'typhon': 'typhon', 'typhon wallet': 'typhon',
  'vespr': 'vespr',
  'begin': 'begin', 'begin wallet': 'begin',
  'yoroi': 'secondfi', 'secondfi': 'secondfi',
  'meteor wallet': 'meteor', 'meteor': 'meteor',
  'sender': 'sender',
  'here wallet': 'here', 'here': 'here',
  'hot wallet': 'hot', 'hot': 'hot',
  'intear wallet': 'intear', 'intear': 'intear',
  'near mobile': 'near-mobile', 'near mobile wallet': 'near-mobile',
  'mynearwallet': 'mynearwallet', 'my near wallet': 'mynearwallet',
});

export const CIP30_KEYS = Object.freeze({
  eternl: 'eternl', lace: 'lace', nami: 'lace', typhoncip30: 'typhon', typhon: 'typhon', vespr: 'vespr', nufi: 'nufi', begin: 'begin', yoroi: 'secondfi',
});

export const NEAR_MODULES = Object.freeze({
  'meteor-wallet': 'meteor', 'sender': 'sender', 'here-wallet': 'here', 'hot-wallet': 'hot', 'nightly': 'nightly',
  'okx-wallet': 'okx', 'intear-wallet': 'intear', 'near-mobile-wallet': 'near-mobile', 'my-near-wallet': 'mynearwallet',
});

/** The provider flags EVM wallets set on their EIP-1193 object, with the
 *  product each one names. */
export const EVM_FLAGS = Object.freeze({
  isMetaMask: 'metamask', isPhantom: 'phantom', isCoinbaseWallet: 'coinbase', isTrust: 'trust', isTrustWallet: 'trust',
  isOkxWallet: 'okx', isOKExWallet: 'okx', isRabby: 'rabby', isBackpack: 'backpack', isRainbow: 'rainbow', isOneKey: 'onekey-app',
  isNufi: 'nufi', isBraveWallet: null, isZerion: null, isFrame: null, isExodus: null, isTokenPocket: null, isBitKeep: null,
  isSafe: null, isTalisman: null, isSubWallet: null, isEnkrypt: null,
});

export const productByName = (name) => NAMES[norm(name)] ?? null;
export const productByRdns = (rdns) => EVM_RDNS[norm(rdns)] ?? null;
