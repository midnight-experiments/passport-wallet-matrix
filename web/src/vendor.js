// The Passport client modules the page uses, imported unchanged from the
// vendored source (vendor/passport/contract/src/wallet/). They hold the EVM
// and Solana arms' format rules, the probe texts and the signer check, so the
// page asks wallets for exactly what the client asks and checks answers the
// way the client checks them. The bundler maps their contract bindings to
// src/vendor-shims/ (see esbuild-config.mjs).

const W = '../../vendor/passport/contract/src/wallet';

export {
  blindMessage, blindMessageBytes, canonicalEvmSignature, canonicalEd25519Signature, sameCanonicalSignature,
  SignerMismatchError, checkSigner,
} from '../../vendor/passport/contract/src/wallet/blind.ts';
export { base58Encode as vendorBase58Encode, parseSolanaPublicKey, evmChecksumAddress, parseEvmAddress, padTag } from '../../vendor/passport/contract/src/wallet/descriptors.ts';
export {
  EIP712_V1_DOMAIN_NAME, EIP712_V1_DOMAIN_VERSION, EIP712_V1_VERIFYING_CONTRACT,
  evmK256Messages, checkEip712V1TypedData, typedDataDigest, domainSeparator, hashStruct,
} from '../../vendor/passport/contract/src/wallet/evm-k256-codec.ts';
export {
  EVM_K256_FORMAT, checkEvmK256Signer, personalMessageDigest, parseEvmSignature, recoverEvmPoint, evmAddressOfPoint,
} from '../../vendor/passport/contract/src/wallet/signer-evm-k256.ts';
export {
  checkSolSignature, verifySolSignature, solBlindSignedBytes,
} from '../../vendor/passport/contract/src/wallet/signer-sol-ed25519.ts';
export {
  SOL_HEAD_LENGTH, SOL_RAW_HEAD, SOL_OFFCHAIN_VERSION, solMessageHead, solFormatOfSigned,
} from '../../vendor/passport/contract/src/wallet/sol-ed25519-message.ts';
export {
  SOL_SIGN_MESSAGE_FEATURE, SOL_SIGN_OFFCHAIN_MESSAGE_FEATURE, solWalletFamily, solWalletFormats, solSignMessageFeature,
  solOffchainV1Feature, solStandardSigner, probeSolWalletFormats, solFormatProbeText, solFormatProbeBytes, solHardwareSigner,
  SOL_FORMAT_PROBE_FIRST_LINE,
} from '../../vendor/passport/contract/src/wallet/sol-ed25519-wallet.ts';

/** Where the vendored modules live, for the page's "about" text. */
export const VENDORED_CLIENT_PATH = W.replace('../../', '');
