import { CONTRACT, DEMO_BOATS, NETWORK, RPC_URL } from '../config';
import type {
  AssemblyView,
  BoatView,
  Exile,
  HistoryPoint,
  Indictment,
  JsonObject,
  Params,
  SeaView,
  TideSnapshot,
} from './types';
import { asString } from './types';

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
  loading: true,
  error: '',
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

export class TideClient {
  private listeners = new Set<(snapshot: TideSnapshot) => void>();
  private timer: number | undefined;
  private account: string | undefined;
  private known = new Set<string>(DEMO_BOATS);
  private snapshot: TideSnapshot = { ...emptySnapshot, history: this.loadHistory() };
  private paramsLoaded = false;

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
    const body = await response.json() as {
      result?: { result?: number[] };
      error?: { cause?: { info?: string }; message?: string };
    };
    if (!response.ok || body.error || !body.result?.result) {
      throw new Error(body.error?.message ?? `Could not read ${method}.`);
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
    const body = await response.json() as { result?: { amount?: string } };
    return body.result?.amount ?? '0';
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
        saved
          .filter((item): item is string => typeof item === 'string')
          .forEach((item) => this.known.add(item));
      }
    } catch {
      // Malformed local state is disposable.
    }
  }

  private rememberKnown(accounts: string[]): void {
    let changed = false;
    accounts.forEach((account) => {
      if (account && !this.known.has(account)) {
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
    try {
      this.emit({ loading: true, error: '' });
      const sea = await this.view<SeaView>('get_sea');
      const params = this.paramsLoaded && this.snapshot.params
        ? this.snapshot.params
        : await this.view<Params>('get_params');
      this.paramsLoaded = true;
      const assembly = await this.view<AssemblyView>('get_assembly');
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
      const boatEntries = await Promise.all(
        [...this.known].map(async (account) => [
          account,
          await this.view<BoatView | null>('get_boat', { account_id: account })
            .catch(() => null),
        ] as const),
      );
      const boats = Object.fromEntries(boatEntries) as Record<string, BoatView | null>;
      const playerBalance = this.account
        ? asString(await this.view<string>('ft_balance_of', {
          account_id: this.account,
        }).catch(() => '0'))
        : '0';
      const playerStorage = this.account
        ? await this.view<JsonObject | null>('storage_balance_of', {
          account_id: this.account,
        }).catch(() => null)
        : null;
      const nearBalance = this.account ? await this.accountView(this.account) : '0';
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
        loading: false,
        error: '',
      });
    } catch (error) {
      this.emit({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not read the live sea.',
      });
    }
  }
}
