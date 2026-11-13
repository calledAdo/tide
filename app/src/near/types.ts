export type JsonObject = Record<string, unknown>;
export type U128Like = string | number | { [key: string]: unknown };

export type Boat = {
  stake: U128Like;
  stake_season: number;
  last_fished: number | null;
  indicted_cycle: number | null;
  counted: boolean;
};

export type BoatView = {
  boat: Boat;
  can_fish_now: boolean;
  exiled_until: number | null;
  fair_share: U128Like;
  full_effort_catch: U128Like;
  full_effort_fuel: U128Like;
};

export type SeaView = {
  season: number;
  synced: boolean;
  seasons_behind: number;
  stock_fish: U128Like;
  caught_this_season: U128Like;
  carrying_capacity: U128Like;
  allee_threshold: U128Like;
  msy_stock: U128Like;
  quota_per_season: U128Like;
  dead: boolean;
  died_season: number | null;
  staked_total: U128Like;
  fleet_snapshot: U128Like;
  voter_count: number;
  season_len_sec: number;
  seconds_left_in_season: number;
  assembly: 'hold' | 'shards' | null;
  minted_catch: U128Like;
  burned_fuel: U128Like;
  burned_build: U128Like;
  burned_shards: U128Like;
  total_supply: U128Like;
};

export type AssemblyResult = {
  cycle: number;
  eligible: number;
  hold_yes: number;
  hold_no: number;
  held: boolean;
  exiled: string[];
};

export type AssemblyView = {
  cycle: number;
  stage: 'hold' | 'shards' | null;
  eligible: number;
  hold_yes: number;
  hold_no: number;
  quorum_shards: number;
  shards: [string, number][];
  last_result: AssemblyResult | null;
};
export type Indictment = [string, U128Like];
export type Exile = [string, number];
export type Params = {
  carrying_capacity_fish: number;
  allee_threshold_fish: number;
  quota_fish_per_season: number;
  min_stake: U128Like;
  faucet_amount: U128Like;
  season_len_sec: number;
  assembly_every_seasons: number;
  exile_seasons: number;
  names_per_shard: number;
  shard_burn: U128Like;
  [key: string]: unknown;
};
export type HistoryPoint = { season: number; stock: number };
export type TransactionRecord = { hash: string; url: string; label: string; time: number };

export type TideSnapshot = {
  sea: SeaView | null;
  params: Params | null;
  assembly: AssemblyView | null;
  indictments: Indictment[];
  previousIndictments: Indictment[];
  exiles: Exile[];
  boats: Record<string, BoatView | null>;
  playerBalance: string;
  playerStorage: JsonObject | null;
  nearBalance: string;
  history: HistoryPoint[];
  loading: boolean;
  error: string;
};

export const asString = (value: U128Like | undefined): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '0' in value) return String(value[0]);
  return '0';
};
