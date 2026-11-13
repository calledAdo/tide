import { useEffect, useState } from 'react';
import { CONTRACT } from '../config';
import { formatAccountAddress, type TransactionResult } from '../near/wallet';
import type {
  AssemblyView,
  BoatView,
  SeaPhase,
  SeaView,
  TransactionRecord,
} from '../near/types';
import { asString } from '../near/types';

export const faucetClaimedKey = (account: string): string =>
  `tide-faucet-claimed:${CONTRACT}:${account}`;

export function isFaucetClaimedLocally(account: string): boolean {
  return localStorage.getItem(faucetClaimedKey(account)) !== null;
}

export function markFaucetClaimed(account: string): void {
  localStorage.setItem(faucetClaimedKey(account), '1');
  window.dispatchEvent(new CustomEvent('tide-faucet-claimed', { detail: account }));
}

export type Toast = {
  id: number;
  kind: 'pending' | 'success' | 'error' | 'info';
  text: string;
  result?: TransactionResult;
  retry?: () => void;
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
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export type SeasonClock = {
  season: number;
  secondsLeft: number;
};

export function useSeasonClock(sea: SeaView | null): SeasonClock {
  const [anchor, setAnchor] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timestamp = Date.now();
    setAnchor(timestamp);
    setNow(timestamp);
  }, [sea?.season, sea?.seconds_left_in_season, sea?.season_len_sec]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!sea) return { season: 0, secondsLeft: 0 };
  const elapsed = Math.max(0, Math.floor((now - anchor) / 1000));
  const secondsLeft = Math.max(0, sea.seconds_left_in_season);
  const seasonLength = Math.max(1, sea.season_len_sec);
  if (elapsed < secondsLeft) {
    return { season: sea.season, secondsLeft: secondsLeft - elapsed };
  }
  const afterRoll = elapsed - secondsLeft;
  return {
    season: sea.season + 1 + Math.floor(afterRoll / seasonLength),
    secondsLeft: seasonLength - (afterRoll % seasonLength),
  };
}

export function boatCanFishAtSeason(boat: BoatView | null | undefined, season: number): boolean {
  return Boolean(
    boat && Number(asString(boat.boat.stake)) > 0
      && boat.boat.stake_season !== season
      && boat.boat.last_fished !== season
      && !(boat.exiled_until && boat.exiled_until > season),
  );
}

export type BoatStatusKey = 'IDLE' | 'READY' | 'FISHED TODAY' | 'RIGGING' | 'INDICTED' | 'EXILED';

export type BoatStatus = {
  key: BoatStatusKey;
  label: string;
  tooltip?: string;
};

export function boatStatus(
  boat: BoatView | null | undefined,
  season: number,
  indicted = false,
  indictmentRatio = '0.0',
  exiledUntil?: number | null,
): BoatStatus {
  if (!boat || Number(asString(boat.boat.stake)) <= 0) return { key: 'IDLE', label: 'IDLE' };
  const exile = exiledUntil ?? boat.exiled_until;
  if (exile && exile > season) {
    return { key: 'EXILED', label: `EXILED UNTIL DAY ${exile}` };
  }
  if (indicted) return { key: 'INDICTED', label: `INDICTED ${indictmentRatio}x` };
  if (boat.boat.stake_season === season) return { key: 'RIGGING', label: 'RIGGING' };
  if (boat.boat.last_fished === season) return { key: 'FISHED TODAY', label: 'FISHED TODAY' };
  if (boat.can_fish_now) {
    return { key: 'READY', label: 'READY', tooltip: 'can fish today, has not yet' };
  }
  return { key: 'IDLE', label: 'IDLE' };
}

export function seaPhase(sea: SeaView | null): SeaPhase {
  if (sea?.phase) return sea.phase;
  return sea?.dead ? 'Wrecked' : 'Fishing';
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
