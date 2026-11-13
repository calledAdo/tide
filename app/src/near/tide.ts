import { CONTRACT, DEMO_BOATS, NETWORK, RPC_URL } from '../config';
import type {
  AssemblyView,
  BoatView,
  Exile,
  HistoryPoint,
  Indictment,
  JsonObject,
  Params,
  ReckoningView,
  SeaView,
  TideSnapshot,
} from './types';
import { asString, boatHasHistory } from './types';
import { readBotAccounts } from './bots';

const emptySnapshot: TideSnapshot = {
  sea: null,
  params: null,
  assembly: null,
  indictments: [],
  previousIndictments: [],
  exiles: [],
  boats: {},
  playerBalance: '0',
  playerStorage: null,
  nearBalance: '0',
  history: [],
  reckoning: null,
  loading: true,
  error: '',
  stale: false,
};

const historyKey = `tide-history:${NETWORK}:${CONTRACT}`;

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function accountList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (
    Array.isArray(item) && typeof item[0] === 'string' ? [item[0]] : []
  ));
}

class RpcError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

type ReadOutcome<T> =
  | { value: T; failed: false }
  | { value: undefined; failed: true };

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

export class TideClient {
  private listeners = new Set<(snapshot: TideSnapshot) => void>();
  private timer: number | undefined;
  private account: string | undefined;
  private known = new Set<string>(DEMO_BOATS);
  private snapshot: TideSnapshot = { ...emptySnapshot, history: this.loadHistory() };
  private paramsLoaded = false;
  private failedRefreshes = 0;
  private refreshTask: Promise<void> | null = null;
  private refreshQueued = false;

  constructor() {
    this.loadKnown();
  }

  subscribe(listener: (snapshot: TideSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  get state(): TideSnapshot {
    return this.snapshot;
  }

  setAccount(account: string | undefined): void {
    this.account = account;
    if (account) this.rememberKnown([account]);
    void this.refresh();
  }

  start(): () => void {
    void this.refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void this.refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, 10_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (this.timer) window.clearInterval(this.timer);
    };
  }

  private emit(change: Partial<TideSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private async view<T>(method: string, args: JsonObject = {}): Promise<T> {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `tide-${method}`,
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: CONTRACT,
          method_name: method,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    if (!response.ok) {
      throw new RpcError(`Could not read ${method}.`, response.status);
    }
    const body = await response.json() as {
      result?: { result?: number[] };
      error?: { cause?: { info?: string }; message?: string };
    };
    if (body.error || body.result?.result === undefined) {
      throw new RpcError(body.error?.message ?? `Could not read ${method}.`, response.status);
    }
    const bytes = new Uint8Array(body.result.result);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  private async accountView(account: string): Promise<string> {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tide-account',
        method: 'query',
        params: {
          request_type: 'view_account',
          finality: 'final',
          account_id: account,
        },
      }),
    });
    if (!response.ok) {
      throw new RpcError('Could not read the account balance.', response.status);
    }
    const body = await response.json() as {
      result?: { amount?: string };
      error?: { message?: string };
    };
    if (body.error || body.result?.amount === undefined) {
      throw new RpcError(
        body.error?.message ?? 'Could not read the account balance.',
        response.status,
      );
    }
    return body.result.amount;
  }

  private async tryView<T>(method: string, args: JsonObject = {}): Promise<ReadOutcome<T>> {
    try {
      return { value: await this.view<T>(method, args), failed: false };
    } catch {
      return { value: undefined, failed: true };
    }
  }

  private async boatView(account: string): Promise<ReadOutcome<BoatView | null>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return {
          value: await this.view<BoatView | null>('get_boat', { account_id: account }),
          failed: false,
        };
      } catch (error) {
        const retryable = error instanceof RpcError
          && (error.status === 429 || error.status >= 500);
        if (!retryable || attempt > 0) return { value: undefined, failed: true };
        await wait(500);
      }
    }
    return { value: undefined, failed: true };
  }

  private async accountViewOutcome(account: string): Promise<ReadOutcome<string>> {
    try {
      return { value: await this.accountView(account), failed: false };
    } catch {
      return { value: undefined, failed: true };
    }
  }

  private async boatViews(
    accounts: string[],
  ): Promise<Array<[string, ReadOutcome<BoatView | null>]>> {
    const results: [string, ReadOutcome<BoatView | null>][] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < accounts.length) {
        const index = next;
        next += 1;
        const account = accounts[index];
        results[index] = [account, await this.boatView(account)];
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, accounts.length) }, () => worker()),
    );
    return results;
  }

  private updateStale(failed: boolean): boolean {
    this.failedRefreshes = failed ? this.failedRefreshes + 1 : 0;
    return this.failedRefreshes >= 2;
  }

  async storageBalance(account: string): Promise<JsonObject | null> {
    return this.view<JsonObject | null>('storage_balance_of', { account_id: account });
  }

  async storageBounds(): Promise<{ min: string; max: string | null }> {
    return this.view<{ min: string; max: string | null }>('storage_balance_bounds');
  }

  private loadKnown(): void {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`tide-known-boats:${CONTRACT}`) ?? '[]',
      ) as unknown;
      if (Array.isArray(saved)) {
        const accounts = saved.filter(
          (item): item is string => typeof item === 'string' && item !== CONTRACT,
        );
        accounts.forEach((item) => this.known.add(item));
        if (accounts.length !== saved.length) {
          localStorage.setItem(
            `tide-known-boats:${CONTRACT}`,
            JSON.stringify(accounts),
          );
        }
      }
    } catch {
      // Malformed local state is disposable.
    }
  }

  private rememberKnown(accounts: string[]): void {
    let changed = false;
    accounts.forEach((account) => {
      if (account && account !== CONTRACT && !this.known.has(account)) {
        this.known.add(account);
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem(
        `tide-known-boats:${CONTRACT}`,
        JSON.stringify([...this.known]),
      );
    }
  }

  private loadHistory(): HistoryPoint[] {
    try {
      const saved = JSON.parse(
        localStorage.getItem(historyKey) ?? '[]',
      ) as unknown;
      if (!Array.isArray(saved)) return [];
      const seasons = new Set<number>();
      return saved
        .flatMap((point) => {
          const item = jsonObject(point);
          const season = numberValue(item.season);
          const stock = numberValue(item.stock);
          if (!Number.isFinite(season) || !Number.isFinite(stock) || seasons.has(season)) {
            return [];
          }
          seasons.add(season);
          return [{ season, stock }];
        })
        .slice(-500);
    } catch {
      return [];
    }
  }

  private rememberHistory(season: number, stock: number): HistoryPoint[] {
    const existing = this.snapshot.history.find((point) => point.season === season);
    if (existing) return this.snapshot.history;
    const history = [...this.snapshot.history, { season, stock }]
      .sort((a, b) => a.season - b.season)
      .slice(-500);
    localStorage.setItem(historyKey, JSON.stringify(history));
    return history;
  }

  async refresh(): Promise<void> {
    if (this.refreshTask) {
      this.refreshQueued = true;
      await this.refreshTask;
      return;
    }
    const task = this.refreshOnce();
    this.refreshTask = task;
    try {
      await task;
    } finally {
      this.refreshTask = null;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private async refreshOnce(): Promise<void> {
    try {
      this.emit({ loading: true, error: '' });
      const [sea, reckoning] = await Promise.all([
        this.view<SeaView>('get_sea'),
        this.view<ReckoningView>('get_reckoning'),
      ]);
      const params = this.paramsLoaded && this.snapshot.params
        ? this.snapshot.params
        : await this.view<Params>('get_params');
      this.paramsLoaded = true;
      const assembly = await this.view<AssemblyView>('get_assembly');
      const botAccounts = await readBotAccounts();
      this.rememberKnown([...botAccounts]);
      const exiles = await this.view<Exile[]>('get_exiles');
      const cycle = Math.floor(sea.season / 3);
      const [indictments, previousIndictments] = await Promise.all([
        this.view<Indictment[]>('get_indictments', { cycle }),
        this.view<Indictment[]>('get_indictments', { cycle: Math.max(0, cycle - 1) }),
      ]);
      const discovered = [
        ...accountList(indictments),
        ...accountList(previousIndictments),
        ...exiles.map((item) => item[0]),
        ...(assembly.shards ?? []).map((item) => item[0]),
        ...(assembly.last_result?.exiled ?? []),
      ];
      this.rememberKnown(discovered);
      const historicalAccounts = new Set(discovered);
      let failed = false;
      const boats = { ...this.snapshot.boats };
      let playerBalance = this.snapshot.playerBalance;
      let playerStorage = this.snapshot.playerStorage;
      let nearBalance = this.snapshot.nearBalance;
      if (this.account) {
        const account = this.account;
        const [playerBoat, balance, storage, near] = await Promise.all([
          this.boatView(account),
          this.tryView<string>('ft_balance_of', { account_id: account }),
          this.tryView<JsonObject | null>('storage_balance_of', { account_id: account }),
          this.accountViewOutcome(account),
        ]);
        failed ||= playerBoat.failed || balance.failed || storage.failed || near.failed;
        if (!playerBoat.failed) boats[account] = playerBoat.value;
        if (!balance.failed) playerBalance = asString(balance.value);
        if (!storage.failed) playerStorage = storage.value;
        if (!near.failed) nearBalance = near.value;
      } else {
        playerBalance = '0';
        playerStorage = null;
        nearBalance = '0';
      }
      const otherAccounts = [...this.known].filter((account) => account !== this.account);
      const boatEntries = await this.boatViews(otherAccounts);
      boatEntries.forEach(([account, result]) => {
        failed ||= result.failed;
        if (!result.failed) boats[account] = result.value;
      });
      const currentKnown = new Set<string>();
      [...this.known].forEach((account) => {
        const boat = boats[account];
        if (account !== CONTRACT && (historicalAccounts.has(account) || boatHasHistory(boat))) {
          currentKnown.add(account);
        } else {
          delete boats[account];
        }
      });
      this.known = currentKnown;
      Object.keys(boats).forEach((account) => {
        if (account === CONTRACT || !currentKnown.has(account)) delete boats[account];
      });
      localStorage.setItem(
        `tide-known-boats:${CONTRACT}`,
        JSON.stringify([...this.known]),
      );
      const history = this.rememberHistory(
        sea.season,
        numberValue(asString(sea.stock_fish)),
      );
      this.emit({
        sea,
        params,
        assembly,
        exiles,
        indictments,
        previousIndictments,
        boats,
        playerBalance,
        playerStorage,
        nearBalance,
        history,
        reckoning,
        loading: false,
        error: '',
        stale: this.updateStale(failed),
      });
    } catch (error) {
      this.emit({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not read the live sea.',
        stale: this.updateStale(true),
      });
    }
  }
}
