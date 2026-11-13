import { Buffer } from 'buffer';

// @near-wallet-selector/ethereum-wallets expects the Node Buffer global in the browser.
globalThis.Buffer ??= Buffer;
