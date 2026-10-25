// About: what the page is, what it never does, and where its rules come from.

import { h, clear, append } from '../../app/dom.js';
import { CARDANO_X, PROVISIONAL_NOTE } from '../../probe/provisional.js';
import { PROBE_NETWORK } from '../../config.js';

export default {
  id: 'about',
  title: 'About',
  order: 90,
  mount(el, ctx) {
    append(clear(el), 
      h('h2', {}, 'About this page'),
      h('p', {}, 'A Midnight Passport account is controlled by devices: wallets of other chains that approve each operation by signing a readable text. This page shows which wallets can do that, through which connection path, and with which caveats, and lets you check your own wallet.'),
      h('h3', {}, 'What it never does'),
      h('ul', {},
        h('li', {}, 'It never asks for a seed phrase, a password or a private key.'),
        h('li', {}, 'It sends nothing to a server: detection, tests and verification run in this page, and a result leaves it only as a file you export.'),
        h('li', {}, `It signs nothing that authorises anything: the approvals it asks for name accounts that do not exist, and the privacy-key requests name the probe network "${PROBE_NETWORK}", where no account lives.`)),
      h('h3', {}, 'Where the rules come from'),
      h('p', {}, 'The EVM and Solana checks use the Passport client\'s own modules, vendored unchanged in this repository (vendor/passport): the formats each arm accepts, the probe texts and the signer check that refuses a signature from any key other than the expected one.'),
      h('p', { class: 'provisional' }, PROVISIONAL_NOTE, ` The Cardano layout-1 prefix used is "${CARDANO_X}".`),
      h('p', { class: 'test-only' }, 'The Cardano arm is test only, address not bound: it cannot check inside the circuit that a Cardano address belongs to the signing key.'),
      h('h3', {}, 'The curated data'),
      h('p', {}, `The table is the curated baseline (data version ${ctx.model.data.version}, updated ${ctx.model.data.updated}): workspace tests with real wallets, emulator runs with public test seeds, and desk research with its sources. Every cell names its evidence.`));
  },
};
