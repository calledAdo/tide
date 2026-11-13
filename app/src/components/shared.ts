import { CONTRACT } from '../config';
import { formatAccountAddress, type TransactionResult } from '../near/wallet';
import type { AssemblyView, SeaView, TransactionRecord } from '../near/types';

export const faucetClaimedKey = (account: string): string => `tide-faucet-claimed:${account}`;

export function isFaucetClaimedLocally(account: string): boolean {
  return localStorage.getItem(faucetClaimedKey(account)) !== null;
}

export function markFaucetClaimed(account: string): void {
  localStorage.setItem(faucetClaimedKey(account), '1');
  window.dispatchEvent(new CustomEvent('tide-faucet-claimed', { detail: account }));
}

export type Toast = {
  id: number;
  kind: 'pending' | 'success' | 'error';
  text: string;
  result?: TransactionResult;
};

export type RunAction = (
  label: string,
  task: () => Promise<TransactionResult>,
) => void;

export function shortName(account: string): string {
  return account.includes('.')
    ? account.split('.')[0]!.slice(0, 9)
    : formatAccountAddress(account);
}

export function seconds(value: number): string {
  return `0:${Math.max(0, value).toString().padStart(2, '0')}`;
}

export function assemblyStage(
  sea: SeaView | null,
  assembly: AssemblyView | null,
): 'hold' | 'shards' | null {
  return sea?.assembly ?? assembly?.stage ?? null;
}

export function loadTransactions(): TransactionRecord[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(`tide-transactions:${CONTRACT}`) ?? '[]',
    ) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is TransactionRecord =>
        Boolean(item && typeof item === 'object' && 'hash' in item && 'label' in item),
      )
      : [];
  } catch {
    return [];
  }
}
