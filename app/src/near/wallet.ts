import {
  setupWalletSelector,
  type Action as WalletAction,
  type WalletSelector,
} from '@near-wallet-selector/core';
import { setupEthereumWallets } from '@near-wallet-selector/ethereum-wallets';
import {
  Account,
  actions,
  KeyPairString,
  KeyPairSigner,
  JsonRpcProvider,
} from 'near-api-js';
import {
  connect as wagmiConnect,
  getAccount,
  reconnect as wagmiReconnect,
  sendTransaction as wagmiSendTransaction,
  switchChain as wagmiSwitchChain,
  waitForTransactionReceipt as wagmiWaitForTransactionReceipt,
} from '@wagmi/core';
import { createConfig, http, injected } from 'wagmi';
import { defineChain, encodeFunctionData, hexToBytes, keccak256, toHex } from 'viem';
import type { EIP1193Provider } from 'viem';
import { API_BASE, CHAIN_ID, CONTRACT, ETH_RPC, EXPLORER, RPC_URL } from '../config';
import type { JsonObject } from './types';

// Adapted from meme-this-near.
const NEAR_EVM_TESTNET = defineChain({
  id: CHAIN_ID,
  name: 'NEAR Protocol Testnet',
  nativeCurrency: { decimals: 18, name: 'NEAR', symbol: 'NEAR' },
  rpcUrls: { default: { http: [ETH_RPC] } },
  blockExplorers: {
    default: { name: 'NEAR EVM Explorer', url: 'https://eth-explorer-testnet.near.org' },
  },
  testnet: true,
});

// Adapted from meme-this-near.
const ADD_KEY_ABI = [{
  type: 'function',
  name: 'addKey',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'public_key_kind', type: 'uint8' },
    { name: 'public_key', type: 'bytes' },
    { name: 'nonce', type: 'uint64' },
    { name: 'is_full_access', type: 'bool' },
    { name: 'is_limited_allowance', type: 'bool' },
    { name: 'allowance', type: 'uint128' },
    { name: 'receiver_id', type: 'string' },
    { name: 'method_names', type: 'string[]' },
  ],
}] as const;

type MetaMaskProvider = EIP1193Provider & { _metamask?: unknown };
type Eip6963Detail = { info?: { rdns?: string }; provider?: MetaMaskProvider };
type WagmiConfig = ReturnType<typeof createConfig>;
type ResultShape = {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  txHash?: string;
};
type WalletApi = {
  signIn: (args: { contractId: string }) => Promise<{ accountId: string }[]>;
  signOut: () => Promise<void>;
  signAndSendTransaction: (args: {
    receiverId: string;
    actions: WalletAction[];
  }) => Promise<ResultShape>;
};

export type WalletSnapshot = {
  account: string | undefined;
  dev: boolean;
  progress: string;
  error: string;
};

export type TransactionResult = { hash: string; url: string };

export const GAS = 180_000_000_000_000n;
export const ETHEREUM_MAX_TGAS = 270_000_000_000_000n;
const METAMASK_TIMEOUT = 'No response from MetaMask. Check the extension and try again.';
const WALLET_INIT_TIMEOUT_MESSAGE = 'Wallet setup timed out. Check your wallet extension and try again.';
export const WALLET_INIT_TIMEOUT_MS = 15_000;

async function withMetaMaskTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(METAMASK_TIMEOUT)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withWalletInitTimeout(operation: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(WALLET_INIT_TIMEOUT_MESSAGE)), WALLET_INIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function selectMetaMaskConnector<T extends {
  readonly id: string;
  readonly rdns?: string | readonly string[];
}>(connectors: readonly T[], fallback: T): T {
  return connectors.find((connector) => connector.id === 'io.metamask'
    || connector.rdns === 'io.metamask'
    || (Array.isArray(connector.rdns) && connector.rdns.includes('io.metamask'))) ?? fallback;
}

function devAccount(): string | undefined {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return undefined;
  }
  const account = localStorage.getItem('tide-dev-account');
  return account && localStorage.getItem(`tide-chip-key:${account}`) ? account : undefined;
}

function providerRequest(
  provider: EIP1193Provider,
  method: string,
  params?: unknown[],
): Promise<unknown> {
  return (provider as unknown as {
    request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  }).request({ method, params });
}

function findInjectedMetaMask(): MetaMaskProvider | undefined {
  type Ethereum = MetaMaskProvider & {
    providers?: MetaMaskProvider[];
    providerMap?: Map<string, MetaMaskProvider> | Record<string, MetaMaskProvider>;
  };
  const ethereum = (window as Window & { ethereum?: Ethereum }).ethereum;
  const mapped = ethereum?.providerMap;
  const fromMap = mapped instanceof Map ? mapped.get('MetaMask') : mapped?.MetaMask;
  const provider = ethereum?._metamask
    ? ethereum
    : ethereum?.providers?.find((item) => item?._metamask) ?? fromMap;
  return provider && typeof provider.request === 'function' ? provider : undefined;
}

function storedWagmiConnectorIds(): string[] {
  try {
    const persisted = JSON.parse(localStorage.getItem('wagmi.store') ?? 'null') as {
      state?: { connections?: { value?: [string, { connector?: { id?: unknown } }][] } };
    } | null;
    return persisted?.state?.connections?.value?.flatMap(([, connection]) =>
      typeof connection.connector?.id === 'string' ? [connection.connector.id] : [],
    ) ?? [];
  } catch {
    return [];
  }
}

function storedWagmiRecentConnectorId(): string | undefined {
  const value = localStorage.getItem('wagmi.recentConnectorId');
  if (!value) return undefined;
  try {
    const decoded: unknown = JSON.parse(value);
    return typeof decoded === 'string' ? decoded : undefined;
  } catch {
    return value;
  }
}

function findAnnouncedMetaMask(): Promise<MetaMaskProvider | undefined> {
  return new Promise((resolve) => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.rdns === 'io.metamask' && detail.provider) {
        window.removeEventListener('eip6963:announceProvider', listener);
        resolve(detail.provider);
      }
    };
    window.addEventListener('eip6963:announceProvider', listener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', listener);
      resolve(undefined);
    }, 500);
  });
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = '';
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output || '1';
}

async function nearRpc<T>(method: string, params: JsonObject): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tide-wallet',
      method,
      params,
    }),
  });
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? `NEAR RPC ${method} failed.`);
  }
  return body.result;
}

export async function getRelayerPublicKeyHex(): Promise<string> {
  const response = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tide-relayer-key',
      method: 'near_getPublicKey',
    }),
  });
  const body = await response.json() as {
    result?: { public_key?: unknown };
    error?: { message?: string };
  };
  const key = body.result?.public_key;
  if (
    !response.ok ||
    body.error ||
    typeof key !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(key)
  ) {
    throw new Error(
      body.error?.message ?? 'Could not read the NEAR testnet relayer public key.',
    );
  }
  return key;
}

export async function hasRelayerActivationKey(
  accountId: string,
  relayerPublicKeyHex: string,
): Promise<boolean> {
  const publicKey = `ed25519:${encodeBase58(hexToBytes(`0x${relayerPublicKeyHex}`))}`;
  try {
    const result = await nearRpc<{
      permission?: { FunctionCall?: { receiver_id?: string; method_names?: string[] } };
    }>('query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: publicKey,
    });
    const permission = result.permission?.FunctionCall;
    return permission?.receiver_id === accountId && Boolean(
      permission.method_names?.includes('rlp_execute'),
    );
  } catch (error) {
    if (/does not exist|doesn't exist|not found|unknown access key/i.test(
      error instanceof Error ? error.message : String(error),
    )) {
      return false;
    }
    throw error;
  }
}

export function buildRelayerActivationData(
  accountId: string,
  relayerPublicKeyHex: string,
  nonce: bigint,
) {
  if (
    !/^0x[a-f0-9]{40}$/.test(accountId) ||
    !/^[a-fA-F0-9]{64}$/.test(relayerPublicKeyHex)
  ) {
    throw new Error('Invalid testnet activation account or relayer key.');
  }
  return {
    to: `0x${keccak256(toHex(accountId)).slice(26)}` as `0x${string}`,
    data: encodeFunctionData({
      abi: ADD_KEY_ABI,
      functionName: 'addKey',
      args: [
        0,
        `0x${relayerPublicKeyHex}`,
        nonce,
        false,
        false,
        0n,
        accountId,
        ['rlp_execute'],
      ],
    }),
  };
}

async function activateRelayerKey(
  config: WagmiConfig,
  provider: EIP1193Provider,
  accountId: string,
  publicKey: string,
): Promise<void> {
  if (await hasRelayerActivationKey(accountId, publicKey)) return;
  const nonceValue = await providerRequest(provider, 'eth_getTransactionCount', [
    accountId,
    'latest',
  ]);
  if (typeof nonceValue !== 'string') {
    throw new Error('MetaMask returned an invalid account nonce.');
  }
  const nonce = BigInt(nonceValue);
  const call = buildRelayerActivationData(accountId, publicKey, nonce);
  const gasValue = await providerRequest(provider, 'eth_estimateGas', [{
    from: accountId,
    ...call,
    gasPrice: '0x1',
    type: '0x0',
    chainId: '0x18e',
    nonce: `0x${nonce.toString(16)}`,
  }]);
  if (typeof gasValue !== 'string') {
    throw new Error('MetaMask returned an invalid activation gas estimate.');
  }
  const hash = await wagmiSendTransaction(config, {
    account: accountId as `0x${string}`,
    ...call,
    gas: BigInt(gasValue),
    gasPrice: 1n,
    type: 'legacy',
    chainId: CHAIN_ID,
    nonce: Number(nonce),
  });
  const receipt = await wagmiWaitForTransactionReceipt(config, {
    hash,
    chainId: CHAIN_ID,
  });
  if (receipt.status !== 'success') {
    throw new Error('MetaMask activation transaction reverted on NEAR testnet.');
  }
  if (!(await hasRelayerActivationKey(accountId, publicKey))) {
    throw new Error('MetaMask activation completed, but the NEAR relayer key is still missing.');
  }
}

function panicMessage(error: unknown): string {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    const match = message.match(/Smart contract panicked:\s*([^\n]+)/i);
    if (match) return match[1].trim();
    current = typeof current === 'object'
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return error instanceof Error ? error.message : 'Transaction failed.';
}

function resultOf(result: ResultShape): TransactionResult {
  const hash = result.transaction?.hash ?? result.transaction_outcome?.id ?? result.txHash ?? '';
  return { hash, url: hash ? `${EXPLORER}/txns/${hash}` : '' };
}

export function formatAccountAddress(account: string): string {
  return /^0x[a-f0-9]{40}$/.test(account)
    ? `${account.slice(0, 6)}…${account.slice(-4)}`
    : account;
}

export function isEthImplicitAccount(account: string | undefined): boolean {
  return typeof account === 'string' && /^0x[a-f0-9]{40}$/.test(account);
}

export function metaMaskErrorMessage(error: unknown): string {
  const message = panicMessage(error);
  if (/4100|not authorized|not authorised/i.test(message)) {
    return "MetaMask hasn't authorised this account for this site. Open MetaMask's Connected sites, " +
      'or reconnect.';
  }
  if (/4001|user rejected|request rejected/i.test(message)) {
    return 'MetaMask request was rejected. Try again when you are ready.';
  }
  return message || 'Could not connect MetaMask.';
}

type EthTransaction = { receiverId: string; actions: WalletAction[] };
type GasAction = WalletAction & { functionCall?: { gas: bigint } };

export function prepareEthImplicitTransactions(
  transactions: readonly EthTransaction[],
): EthTransaction[] {
  return transactions.flatMap(({ receiverId, actions: list }) => list.map((item) => {
    const action = item as GasAction;
    if (!action.functionCall || action.functionCall.gas <= ETHEREUM_MAX_TGAS) {
      return { receiverId, actions: [item] };
    }
    return {
      receiverId,
      actions: [{
        ...action,
        functionCall: {
          ...action.functionCall,
          gas: ETHEREUM_MAX_TGAS,
        },
      } as WalletAction],
    };
  }));
}

export class TideWallet {
  private selector: WalletSelector | undefined;
  private wagmi: WagmiConfig | undefined;
  private provider: MetaMaskProvider | undefined;
  private wallet: WalletApi | undefined;
  private listeners = new Set<(snapshot: WalletSnapshot) => void>();
  private snapshot: WalletSnapshot = {
    account: devAccount(),
    dev: Boolean(devAccount()),
    progress: '',
    error: '',
  };
  private initialized = false;
  private walletInitPromise: Promise<void> | undefined;
  private walletInitAttempt = 0;
  private readonly metaMaskConnectorId = 'io.metamask';

  subscribe(listener: (snapshot: WalletSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  get state(): WalletSnapshot {
    return this.snapshot;
  }

  private setState(change: Partial<WalletSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private resetInitialization(): void {
    this.initialized = false;
    this.wagmi = undefined;
    this.provider = undefined;
    this.selector = undefined;
    this.wallet = undefined;
  }

  private async initializeWalletOnce(attempt: number): Promise<void> {
    const provider = await findAnnouncedMetaMask() ?? findInjectedMetaMask();
    if (!provider) throw new Error('MetaMask not detected in this browser.');

    const target = {
      id: this.metaMaskConnectorId,
      name: 'MetaMask',
      rdns: 'io.metamask',
      provider: () => provider,
    };
    const wagmi = createConfig({
      chains: [NEAR_EVM_TESTNET],
      connectors: [injected({ target, shimDisconnect: true })],
      transports: { [CHAIN_ID]: http(ETH_RPC) },
      ssr: true,
    });
    for (const connector of wagmi.connectors) {
      const originalIsAuthorized = connector.isAuthorized.bind(connector);
      connector.isAuthorized = async () => {
        const connectorProvider = await connector.getProvider().catch(() => undefined);
        if (!connectorProvider
          || typeof connectorProvider !== 'object'
          || !('request' in connectorProvider)) return false;
        try {
          const accounts = await (connectorProvider as {
            request: (request: { method: string }) => Promise<unknown>;
          })
            .request({ method: 'eth_accounts' });
          return Array.isArray(accounts) && accounts.length > 0 ? originalIsAuthorized() : false;
        } catch {
          return false;
        }
      };
    }

    const recentConnectorId = storedWagmiRecentConnectorId();
    const staleConnections = storedWagmiConnectorIds().some((id) => id !== this.metaMaskConnectorId);
    if ((recentConnectorId && recentConnectorId !== this.metaMaskConnectorId) || staleConnections) {
      await wagmi.storage?.removeItem('recentConnectorId');
      if (staleConnections) localStorage.removeItem('wagmi.store');
      wagmi.setState((state) => ({
        ...state,
        connections: new Map(),
        current: null,
        status: 'disconnected',
      }));
    }
    await withMetaMaskTimeout(wagmiReconnect(wagmi, { connectors: wagmi.connectors }));

    const selector = await setupWalletSelector({
      network: 'testnet',
      modules: [setupEthereumWallets({
        wagmiConfig: wagmi,
        chainId: CHAIN_ID,
        skipSignInAccessKey: true,
      })],
    });
    const wallet = await selector.wallet('ethereum-wallets') as unknown as WalletApi;
    if (attempt !== this.walletInitAttempt) return;
    this.provider = provider;
    this.wagmi = wagmi;
    this.selector = selector;
    this.wallet = wallet;
    selector.subscribeOnAccountChange((account) => {
      this.setState({ account: account || undefined, dev: false });
    });
    const existing = selector.store.getState().accounts[0]?.accountId;
    if (existing) this.setState({ account: existing, dev: false });
  }

  async initializeWallet(): Promise<void> {
    if (this.snapshot.dev || this.initialized) return this.walletInitPromise;
    const attempt = ++this.walletInitAttempt;
    this.initialized = true;
    const init = this.initializeWalletOnce(attempt);
    const promise = withWalletInitTimeout(init);
    this.walletInitPromise = promise;
    try {
      await promise;
    } catch (error) {
      if (attempt === this.walletInitAttempt) {
        this.walletInitAttempt += 1;
        this.walletInitPromise = undefined;
        this.resetInitialization();
        const message = metaMaskErrorMessage(error);
        this.setState({ progress: '', error: message });
      }
      throw error;
    }
  }

  private assertMetaMaskAccount(accountId: string | undefined): void {
    if (!isEthImplicitAccount(accountId)) return;
    const active = this.wagmi && getAccount(this.wagmi);
    if (!active?.isConnected
      || active.connector?.id !== this.metaMaskConnectorId
      || active.address?.toLowerCase() !== accountId) {
      throw new Error('Reconnect MetaMask before signing this transaction.');
    }
  }

  async connect(): Promise<void> {
    if (this.snapshot.dev) {
      throw new Error('MetaMask-only wallet actions are not available with the dev signer.');
    }
    try {
      this.setState({ progress: 'Waiting for MetaMask…', error: '' });
      try {
        await this.initializeWallet();
      } catch (error) {
        if (!(error instanceof Error)
          || !/MetaMask not detected in this browser/i.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
        await this.initializeWallet();
      }
      if (!this.wagmi || !this.provider || !this.wallet) {
        throw new Error('Wallet setup is incomplete. Try again.');
      }
      const fallback = this.wagmi.connectors[0];
      if (!fallback) throw new Error('Wallet setup is incomplete. Try again.');
      const connector = selectMetaMaskConnector(this.wagmi.connectors, fallback);
      const provider = await connector.getProvider().catch(() => undefined);
      if (!provider) throw new Error('MetaMask not detected in this browser.');
      const active = getAccount(this.wagmi);
      let address = active.isConnected
        && active.connector?.id === this.metaMaskConnectorId
        && active.address
        ? active.address.toLowerCase()
        : undefined;
      if (!address) {
        try {
          const result = await withMetaMaskTimeout(wagmiConnect(this.wagmi, { connector }));
          address = result.accounts[0]?.toLowerCase() ?? getAccount(this.wagmi).address?.toLowerCase();
        } catch (error) {
          if ((error as { name?: unknown }).name !== 'ConnectorAlreadyConnectedError') throw error;
          address = getAccount(this.wagmi).address?.toLowerCase();
        }
      }
      if (!address || !isEthImplicitAccount(address)) {
        throw new Error('MetaMask did not return a NEAR eth-implicit account.');
      }
      const connected = getAccount(this.wagmi);
      if (connected.connector?.id !== this.metaMaskConnectorId
        || connected.address?.toLowerCase() !== address) {
        throw new Error('Reconnect MetaMask before signing.');
      }
      this.setState({ account: address, progress: 'Switching to NEAR testnet…' });
      if (getAccount(this.wagmi).chainId !== CHAIN_ID) {
        await withMetaMaskTimeout(wagmiSwitchChain(this.wagmi, { chainId: CHAIN_ID }));
      }
      this.assertMetaMaskAccount(address);
      this.setState({ progress: 'Setting up your account…' });
      const response = await fetch(`${API_BASE}/testnet/onboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: address }),
      });
      const text = await response.text();
      if (!response.ok) {
        let message = text;
        try {
          const body = JSON.parse(text) as { error?: unknown };
          if (typeof body.error === 'string') message = body.error;
        } catch {
          // The API may return the message as plain text.
        }
        throw new Error(message || `Account setup failed (${response.status}).`);
      }
      this.setState({ progress: 'Approve the relayer key in MetaMask…' });
      await activateRelayerKey(
        this.wagmi,
        provider as EIP1193Provider,
        address,
        await getRelayerPublicKeyHex(),
      );
      const signed = await withMetaMaskTimeout(this.wallet.signIn({ contractId: CONTRACT }));
      this.assertMetaMaskAccount(address);
      const account = signed[0]?.accountId ?? address;
      if (!isEthImplicitAccount(account)) {
        throw new Error('MetaMask did not return a NEAR eth-implicit account.');
      }
      this.setState({ account, dev: false, progress: '', error: '' });
    } catch (error) {
      const message = metaMaskErrorMessage(error);
      this.setState({ progress: '', error: message });
      throw new Error(message);
    }
  }

  async disconnect(): Promise<void> {
    if (this.wallet) await this.wallet.signOut();
    this.setState({ account: undefined, error: '', progress: '' });
  }

  private async devCall(method: string, args: JsonObject): Promise<TransactionResult> {
    const accountId = devAccount();
    const secret = accountId ? localStorage.getItem(`tide-chip-key:${accountId}`) : null;
    if (!accountId || !secret) {
      throw new Error('The localhost dev signer is not configured.');
    }
    const account = new Account(
      accountId,
      new JsonRpcProvider({ url: RPC_URL }),
      KeyPairSigner.fromSecretKey(secret as KeyPairString),
    );
    const result = await account.signAndSendTransaction({
      receiverId: CONTRACT,
      actions: [actions.functionCall(method, args, GAS, 0n)],
    });
    return resultOf(result as unknown as ResultShape);
  }

  async call(
    method: string,
    args: JsonObject = {},
    deposit = 0n,
  ): Promise<TransactionResult> {
    if (this.snapshot.dev) {
      if (deposit !== 0n) {
        throw new Error('This wallet-only action is not available with the dev signer.');
      }
      try {
        return await this.devCall(method, args);
      } catch (error) {
        throw new Error(panicMessage(error));
      }
    }
    if (!this.wallet || !this.snapshot.account) throw new Error('Connect MetaMask first.');
    this.assertMetaMaskAccount(this.snapshot.account);
    const action = actions.functionCall(method, args, GAS, deposit) as unknown as WalletAction;
    try {
      const transactions = prepareEthImplicitTransactions([{
        receiverId: CONTRACT,
        actions: [action],
      }]);
      const result = await withMetaMaskTimeout(this.wallet.signAndSendTransaction({
        receiverId: CONTRACT,
        actions: transactions[0]!.actions,
      }));
      return resultOf(result);
    } catch (error) {
      throw new Error(panicMessage(error));
    }
  }

  async transferNear(recipient: string, amount: bigint): Promise<TransactionResult> {
    if (this.snapshot.dev) {
      throw new Error('NEAR withdrawals are not available with the dev signer.');
    }
    if (!this.wallet) throw new Error('Connect MetaMask first.');
    this.assertMetaMaskAccount(this.snapshot.account);
    try {
      return resultOf(await withMetaMaskTimeout(this.wallet.signAndSendTransaction({
        receiverId: recipient,
        actions: [actions.transfer(amount) as unknown as WalletAction],
      })));
    } catch (error) {
      throw new Error(panicMessage(error));
    }
  }

  async onboard(): Promise<void> {
    if (!this.snapshot.account || this.snapshot.dev) {
      throw new Error('Testnet onboarding is not available with the dev signer.');
    }
    const response = await fetch(`${API_BASE}/testnet/onboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: this.snapshot.account }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body || `Testnet onboarding failed (${response.status}).`);
  }
}
