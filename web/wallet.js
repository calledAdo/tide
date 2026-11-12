import { setupWalletSelector } from 'https://esm.sh/@near-wallet-selector/core@10.1.4';
import { setupModal } from 'https://esm.sh/@near-wallet-selector/modal-ui@10.1.4';
import { setupMeteorWallet } from 'https://esm.sh/@near-wallet-selector/meteor-wallet@10.1.4';
import { setupHotWallet } from 'https://esm.sh/@near-wallet-selector/hot-wallet@10.1.4';
import { setupIntearWallet } from 'https://esm.sh/@near-wallet-selector/intear-wallet@10.1.4';
import { setupMyNearWallet } from 'https://esm.sh/@near-wallet-selector/my-near-wallet@10.1.4';
import {
  Account,
  actions,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner
} from 'https://esm.sh/near-api-js@7.4.0';

const GAS = 100_000_000_000_000n;
const KEY_ALLOWANCE = 250_000_000_000_000_000_000_000n;
const METHODS = ['stake', 'unstake', 'fish', 'vote_hold', 'write_shard', 'tick'];

function panicMessage(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    const match = message.match(/Smart contract panicked:\s*([^\n]+)/i);
    if (match) {
      return match[1].trim();
    }
    current = current.cause;
  }
  return error instanceof Error ? error.message : String(error || 'Transaction failed.');
}

function transactionHash(result) {
  return result?.transaction?.hash
    || result?.transaction_outcome?.id
    || result?.transaction?.transaction_hash
    || result?.txHash
    || '';
}

function resultFor(result) {
  const hash = transactionHash(result);
  return { hash, url: hash ? 'https://testnet.nearblocks.io/txns/' + hash : '' };
}

function isDevHost() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export function createTideWallet({ contract, rpc, onChange }) {
  let selector = null;
  let modal = null;
  let accountId = null;
  let ready;

  function storedDevAccount() {
    if (!isDevHost()) {
      return null;
    }
    const account = localStorage.getItem('tide-dev-account');
    return account && localStorage.getItem('tide-chip-key:' + account) ? account : null;
  }

  function currentAccount() {
    if (accountId) {
      return accountId;
    }
    return storedDevAccount();
  }

  function notify(account) {
    accountId = account || null;
    onChange(currentAccount());
  }

  async function setup() {
    selector = await setupWalletSelector({
      network: 'testnet',
      modules: [
        setupMeteorWallet(),
        setupHotWallet(),
        setupIntearWallet(),
        setupMyNearWallet()
      ]
    });
    modal = setupModal(selector, {
      contractId: contract,
      description: '$TIDE fishery on NEAR testnet'
    });
    const selected = selector.store.getState().accounts[0]?.accountId;
    if (selected) {
      accountId = selected;
    }
    selector.subscribeOnAccountChange(account => notify(account?.accountId));
    onChange(currentAccount());
  }

  ready = setup();

  async function connect() {
    await ready;
    if (modal) {
      modal.show();
    }
  }

  async function disconnect() {
    await ready;
    if (selector) {
      await (await selector.wallet()).signOut();
    }
    notify(null);
  }

  async function signedTransaction(definitions) {
    await ready;
    const wallet = await selector.wallet();
    const result = await wallet.signAndSendTransaction({
      receiverId: contract,
      actions: definitions.map(definition => actions.functionCall(
        definition.method,
        definition.args || {},
        BigInt(definition.gas || GAS),
        BigInt(definition.deposit || 0n)
      ))
    });
    return resultFor(result);
  }

  async function enableOneTap() {
    const account = currentAccount();
    if (!account) {
      throw new Error('Connect a wallet first.');
    }
    if (localStorage.getItem('tide-chip-key:' + account)) {
      return { hash: '', url: '' };
    }
    const keyPair = KeyPair.fromRandom('ed25519');
    await ready;
    const wallet = await selector.wallet();
    const result = await wallet.signAndSendTransaction({
      receiverId: account,
      actions: [actions.addFunctionCallAccessKey(
        keyPair.getPublicKey(),
        contract,
        METHODS,
        KEY_ALLOWANCE
      )]
    });
    localStorage.setItem('tide-chip-key:' + account, keyPair.toString());
    return resultFor(result);
  }

  async function call(method, args, options = {}) {
    const account = currentAccount();
    const deposit = BigInt(options.deposit || 0n);
    const gas = BigInt(options.gas || GAS);
    if (!account) {
      throw new Error('Connect a wallet first.');
    }
    const secret = localStorage.getItem('tide-chip-key:' + account);
    if (secret && METHODS.includes(method) && deposit === 0n) {
      try {
        const nearAccount = new Account(
          account,
          new JsonRpcProvider({ url: rpc }),
          KeyPairSigner.fromSecretKey(secret)
        );
        const result = await nearAccount.signAndSendTransaction({
          receiverId: contract,
          actions: [actions.functionCall(method, args || {}, gas, 0n)]
        });
        return resultFor(result);
      } catch (error) {
        throw new Error(panicMessage(error));
      }
    }
    try {
      return await signedTransaction([{ method, args, gas, deposit }]);
    } catch (error) {
      throw new Error(panicMessage(error));
    }
  }

  async function batch(definitions) {
    try {
      return await signedTransaction(definitions);
    } catch (error) {
      throw new Error(panicMessage(error));
    }
  }

  return {
    connect,
    disconnect,
    get account() {
      return currentAccount();
    },
    get oneTap() {
      const account = currentAccount();
      return Boolean(account && localStorage.getItem('tide-chip-key:' + account));
    },
    enableOneTap,
    call,
    batch
  };
}
