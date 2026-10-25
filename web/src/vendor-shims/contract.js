// Stands in for the vendored client's contract bindings (`./contract.js`,
// which loads the compiled account contract). The wallet table only builds
// texts and checks signatures; it never proves, deploys or derives on-chain
// values, so it ships without the compiled contract. Every binding throws
// when used, so a code path that would need the contract fails loudly
// instead of producing a wrong value.

const unavailable = (name) => () => {
  throw new Error(`${name} needs the compiled account contract, which the wallet table page does not load`);
};

export const pureCircuits = new Proxy({}, {
  get: (_target, key) => (typeof key === 'string' ? unavailable(`pureCircuits.${key}`) : undefined),
});
export const ledger = unavailable('ledger');
export const Contract = unavailable('Contract');
