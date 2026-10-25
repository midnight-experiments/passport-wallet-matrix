// Node globals that the Ledger and NEAR libraries use in the browser. The
// bundler imports these bindings only into the modules that name them.
import { Buffer } from 'buffer';

export { Buffer };
export const process = {
  env: { NODE_ENV: 'production' },
  browser: true,
  version: '',
  versions: {},
  nextTick: (f, ...a) => queueMicrotask(() => f(...a)),
};
