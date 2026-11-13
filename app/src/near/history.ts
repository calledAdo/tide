import { API_BASE } from '../config';

export type LeaderboardRow = {
  account: string;
  catch?: string | number;
  net?: string | number;
  indictments?: number;
  trips?: number;
  stake?: string | number;
};

export type TripRecord = {
  season: number;
  catch: string | number;
  fuel: string | number;
  fairShare: string | number;
  effortBps: number;
  tx?: string;
  ts?: string | number;
  indicted?: boolean;
};

function recordValue(
  record: Record<string, unknown>,
  keys: string[],
): string | number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return value;
  }
  return undefined;
}

function recordMatchesSeason(record: Record<string, unknown>, season: number): boolean {
  const recordSeason = recordValue(record, ['season', 'day']);
  if (recordSeason !== undefined && Number(recordSeason) === season) return true;
  const cycle = recordValue(record, ['cycle', 'indicted_cycle']);
  return cycle !== undefined && Number(cycle) === Math.floor(season / 3);
}

export function tripIsIndicted(
  trip: TripRecord,
  indictments: Record<string, unknown>[] = [],
): boolean {
  const caught = Number(trip.catch);
  const fairShare = Number(trip.fairShare);
  return Boolean(trip.indicted)
    || (Number.isFinite(caught) && Number.isFinite(fairShare) && caught > fairShare)
    || indictments.some((record) => recordMatchesSeason(record, trip.season));
}

export function tripIndictmentRatio(trip: TripRecord): string {
  const caught = Number(trip.catch);
  const fairShare = Number(trip.fairShare);
  if (!Number.isFinite(caught) || !Number.isFinite(fairShare) || fairShare <= 0) return '—';
  return `${(caught / fairShare).toFixed(1)}×`;
}

export function indictmentOverShare(
  history: BoatHistory,
  cycle: number,
): string | number | undefined {
  const record = history.indictments.find((item) => {
    const value = recordValue(item, ['cycle', 'indicted_cycle']);
    return value !== undefined && Number(value) === cycle;
  });
  return record
    ? recordValue(record, ['overShare', 'over_share', 'overage', 'overageTotal'])
    : undefined;
}

export type BoatHistory = {
  totals: {
    catch?: string | number;
    fuel?: string | number;
    net?: string | number;
    trips?: number;
    indictments?: number;
    overageTotal?: string | number;
    exiles?: number;
    votesYes?: number;
    votesNo?: number;
    shardsWritten?: number;
  };
  trips: TripRecord[];
  indictments: Record<string, unknown>[];
  exiles: Record<string, unknown>[];
  stakes: Record<string, unknown>[];
  votes: Record<string, unknown>[];
  shards: Record<string, unknown>[];
};

export type AssemblyHistory = {
  cycle: number;
  held: boolean;
  holdYes: number;
  holdNo: number;
  eligible: number;
  shards: Record<string, number>;
  exiled: string[];
  closedAt?: string | number;
};

export type TideEvent = Record<string, unknown> & {
  event?: string;
  account?: string;
  data?: Record<string, unknown> & { memo?: unknown };
  season?: number;
};

type EventsResponse = { events?: TideEvent[] };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`History unavailable (${response.status}).`);
  return response.json() as Promise<T>;
}

export const historyApi = {
  events: async (params = ''): Promise<TideEvent[]> => {
    const response = await get<EventsResponse>(`/events${params}`);
    return Array.isArray(response.events) ? response.events : [];
  },
  faucetClaimed: async (account: string): Promise<boolean> => {
    const events = await historyApi.events(
      `?account=${encodeURIComponent(account)}&event=ft_mint`,
    );
    return events.some((event) => event.data?.memo === 'faucet');
  },
  boat: (account: string) => get<BoatHistory>(`/boat/${encodeURIComponent(account)}/history`),
  assemblies: (limit = 12, active = false) => get<AssemblyHistory[]>(
    `/assemblies?${active ? 'active=true&' : ''}limit=${limit}`,
  ),
  leaderboard: (by: 'catch' | 'net' | 'indictments' = 'catch') =>
    get<LeaderboardRow[]>(`/leaderboard?by=${by}`),
  indexerStatus: () => get<Record<string, unknown>>('/indexer/status'),
};
