export const CONTRACT = 'sea-1794591365.tide-sponsor-53394.testnet';
export const DEAD_SEA = {
  contract: 'tide-1794517191.memethis-t40-demo.testnet',
  diedSeason: 1103,
} as const;
export const NETWORK = 'testnet' as const;
export const RPC_URL = 'https://test.rpc.fastnear.com';
export const API_BASE = import.meta.env.VITE_TIDE_API || '/api';
export const EXPLORER = 'https://testnet.nearblocks.io';
export const ETH_RPC = 'https://eth-rpc.testnet.near.org';
export const CHAIN_ID = 398;
export const TOKEN_DECIMALS = 18;
export const DEMO_BOATS = [
  'ana-1794517191.memethis-t40-demo.testnet',
  'ben-1794517191.memethis-t40-demo.testnet',
  'cy-1794517191.memethis-t40-demo.testnet',
  'dee-1794517191.memethis-t40-demo.testnet',
  'eve-1794517191.memethis-t40-demo.testnet',
  'greedy-1794517191.memethis-t40-demo.testnet',
] as const;

export const yocto = (amount: string | bigint): bigint => {
  const value = typeof amount === 'bigint' ? amount.toString() : amount.trim();
  if (!/^\d+$/.test(value)) throw new Error('Amount must be a whole token-unit value.');
  return BigInt(value);
};

export const tideUnits = (amount: string): bigint => {
  const clean = amount.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,18})?$/.test(clean)) throw new Error('Enter a valid TIDE amount.');
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0') || '0');
};

export const tideAmountExceedsBalance = (amount: string, balance: string): boolean => {
  try {
    return tideUnits(amount) > BigInt(balance || '0');
  } catch {
    return false;
  }
};

export const nearUnits = (amount: string): bigint => {
  const clean = amount.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,24})?$/.test(clean)) throw new Error('Enter a valid NEAR amount.');
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0') || '0');
};
