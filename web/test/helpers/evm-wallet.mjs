// A software EVM wallet as an EIP-1193 provider, over a public test key.
// `mode` makes it misbehave the ways real wallets do:
//   deterministic  RFC 6979, as MetaMask (the default)
//   hedged         fresh randomness in every signature (an MPC or hedged signer)
//   chainid        signs typed data with its chainId added to the domain
//   other-key      answers with another key's signature
//   refuse-typed   refuses eth_signTypedData_v4 (as with code 4001)
//   ledger-6a80    refuses typed data with a Ledger status 0x6a80
//   smart          answers with a 130-byte contract-account signature
//   refuse-connect refuses eth_requestAccounts
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { typedDataDigest, personalMessageDigest, evmChecksumAddress, hashStruct } from '../../src/vendor.js';
import { toHex, fromHex } from '../../src/bytes.js';
import { testSecp256k1 } from './keys.mjs';

export const addressOf = (sk) => keccak_256(secp256k1.getPublicKey(sk, false).subarray(1)).subarray(12);

function sign(digest, sk, hedged) {
  const rec = secp256k1.sign(digest, sk, { prehash: false, format: 'recovered', ...(hedged ? { extraEntropy: true } : {}) });
  return '0x' + toHex(new Uint8Array([...rec.subarray(1), 27 + rec[0]]));
}

// The typed data's digest under a domain with a chainId, as wallets that add
// one compute it (written out here, independently of the page's code).
const enc = (s) => new TextEncoder().encode(s);
function chainDigest(td, chainId) {
  const w = new Uint8Array(32); let x = BigInt(chainId); for (let i = 31; i >= 0; i--) { w[i] = Number(x & 0xffn); x >>= 8n; }
  const dom = keccak_256(new Uint8Array([...keccak_256(enc('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
    ...keccak_256(enc(td.domain.name)), ...keccak_256(enc(td.domain.version)), ...w, ...new Uint8Array(12), ...fromHex(td.domain.verifyingContract)]));
  const { EIP712Domain: _d, ...types } = td.types;
  return keccak_256(new Uint8Array([0x19, 0x01, ...dom, ...hashStruct(td.primaryType, td.message, types)]));
}

export function evmProvider({ label = 'evm one', mode = 'deterministic', otherLabel = 'evm other', chainId = '0xaa36a7', clientVersion = 'TestWallet/v1.0.0', flags = {} } = {}) {
  const sk = testSecp256k1(label);
  const other = testSecp256k1(otherLabel);
  const address = evmChecksumAddress(addressOf(sk));
  const calls = [];
  const provider = {
    ...flags,
    calls,
    address,
    async request({ method, params }) {
      calls.push(method);
      switch (method) {
        case 'eth_requestAccounts':
          if (mode === 'refuse-connect') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return [address.toLowerCase()];
        case 'eth_accounts': return [address.toLowerCase()];
        case 'eth_chainId': return chainId;
        case 'web3_clientVersion': return clientVersion;
        case 'eth_signTypedData_v4': {
          if (mode === 'refuse-typed') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          if (mode === 'ledger-6a80') throw Object.assign(new Error('Ledger device: UNKNOWN_ERROR (0x6a80)'), { statusCode: 0x6a80 });
          if (mode === 'smart') return '0x' + '11'.repeat(130);
          const td = JSON.parse(params[1]);
          const digest = mode === 'chainid' ? chainDigest(td, chainId) : typedDataDigest(td);
          return sign(digest, mode === 'other-key' ? other : sk, mode === 'hedged');
        }
        case 'personal_sign': {
          const msg = fromHex(params[0]);
          return sign(personalMessageDigest(msg), mode === 'other-key' ? other : sk, mode === 'hedged');
        }
        default: throw Object.assign(new Error(`method ${method} not supported`), { code: 4200 });
      }
    },
    on() {},
  };
  return provider;
}
