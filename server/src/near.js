import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';

export const TGAS = 1_000_000_000_000n;

export function isUnknownAccountError(error) {
  if (!error) return false;
  const details = [error.name, error.message, error.type, error.data, error.cause]
    .map((part) => typeof part === 'string' ? part : JSON.stringify(part ?? ''))
    .join(' ');
  return /UNKNOWN_ACCOUNT|unknown account|does not exist|account .* not found/i.test(details);
}

function transactionHash(result) {
  const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id;
  if (typeof hash !== 'string' || !hash) throw new Error('NEAR transaction did not return a hash.');
  return hash;
}

export function createNear(config) {
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const signer = KeyPairSigner.fromSecretKey(config.sponsorPrivateKey);
  const sponsor = new Account(config.sponsorAccountId, provider, signer);

  return {
    provider,
    sponsor,
    async view(contractId, method, args = {}) {
      const result = await provider.callFunction({
        contractId,
        method,
        args,
        blockQuery: { finality: 'final' },
      });
      return result;
    },
    async balance(accountId) {
      try {
        const result = await provider.viewAccount({ accountId, blockQuery: { finality: 'final' } });
        return BigInt(result.amount);
      } catch (error) {
        if (isUnknownAccountError(error)) return 0n;
        throw error;
      }
    },
    async sponsorBalance() {
      return this.balance(config.sponsorAccountId);
    },
    async send(receiverId, txActions) {
      const result = await sponsor.signAndSendTransaction({ receiverId, actions: txActions });
      return transactionHash(result);
    },
  };
}

export { actions, transactionHash };
