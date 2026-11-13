import {
  isEthImplicitAccount,
  type TideWallet,
  type TransactionResult,
  type WalletCall,
} from './wallet';
import type { JsonObject } from './types';

export type StorageClient = {
  storageBalance: (account: string) => Promise<Record<string, unknown> | null>;
  storageBounds: () => Promise<{ min: string; max: string | null }>;
};

export type RegistrationProgress = (message: string) => void;

type RegisteredOperation = WalletCall & { progress: string };

export async function callWithStorageRegistration(
  wallet: TideWallet,
  storage: StorageClient,
  account: string,
  operation: RegisteredOperation,
  onProgress?: RegistrationProgress,
): Promise<TransactionResult> {
  const balance = await storage.storageBalance(account);
  if (balance !== null) {
    onProgress?.(operation.progress);
    return wallet.call(operation.method, operation.args ?? {}, operation.deposit ?? 0n);
  }

  const bounds = await storage.storageBounds();
  const registration: WalletCall = {
    method: 'storage_deposit',
    args: { account_id: account, registration_only: true } as JsonObject,
    deposit: BigInt(bounds.min),
  };
  const calls = [registration, operation];
  const metaMaskSplit = !wallet.state.dev && isEthImplicitAccount(wallet.state.account);
  if (metaMaskSplit) {
    onProgress?.(
      `MetaMask will ask for two confirmations: registering… then ${operation.progress}`,
    );
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return wallet.callBatch(calls, (index) => {
    onProgress?.(index === 0 ? 'registering…' : operation.progress);
  });
}

export function claimFaucet(
  wallet: TideWallet,
  storage: StorageClient,
  account: string,
  onProgress?: RegistrationProgress,
): Promise<TransactionResult> {
  return callWithStorageRegistration(
    wallet,
    storage,
    account,
    { method: 'claim_faucet', args: {}, progress: 'claiming…' },
    onProgress,
  );
}
