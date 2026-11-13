import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { readFile } from 'node:fs/promises';

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
  let botKeysPromise;

  async function botKeys() {
    if (!botKeysPromise) {
      botKeysPromise = (async () => {
        try {
          const parsed = JSON.parse(await readFile(config.botKeysFile, 'utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BOT_KEYS_FILE must contain an account-to-key object.');
          const keys = new Map();
          for (const [accountId, secretKey] of Object.entries(parsed)) {
            if (typeof secretKey !== 'string' || !secretKey.startsWith('ed25519:')) continue;
            keys.set(accountId, secretKey);
          }
          return keys;
        } catch (error) {
          if (error.code === 'ENOENT') return new Map();
          throw error;
        }
      })();
    }
    return botKeysPromise;
  }

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
    async botAccounts() {
      return new Set((await botKeys()).keys());
    },
    async botSend(accountId, receiverId, txActions) {
      const secretKey = (await botKeys()).get(accountId);
      if (!secretKey) throw new Error(`No bot key is configured for ${accountId}.`);
      const account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(secretKey));
      const result = await account.signAndSendTransaction({ receiverId, actions: txActions });
      return transactionHash(result);
    },
  };
}

export { actions, transactionHash };
