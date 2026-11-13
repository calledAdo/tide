type SimBoat = {
  name: string;
  status: string;
  exiledUntil: number | null;
  lastCatch: number;
  fairShare: number;
  indictedThisCycle: boolean;
};

type SimState = {
  season: number;
  stock: number;
  dead: boolean;
  boats: SimBoat[];
  minted: number;
  burned: number;
  aprSoFar: number;
  assembly: {
    eligible: number;
    hold_yes: number;
    hold_no: number;
    held: boolean;
    shards: Record<string, number>;
    exiled: string[];
  } | null;
};
export type SimEngine = { season: number; state: SimState; events: SimEvent[]; step: () => SimEvent[] };
export type SimEvent = { season: number; kind: string; text: string };
export type SimModule = {
  SCENARIOS: { id: string; label: string; blurb: string }[];
  constants: {
    K: number;
    A: number;
    QUOTA: number;
    MSY_STOCK: number;
    SEASONS: number;
  };
  growth: (stock: number) => number;
  catchAtEffort: (stock: number, stake: number, totalStake: number, effort: number) => number;
  fairCatch: (stake: number, totalStake: number) => number;
  create: (id: string) => SimEngine;
  runToEnd: (id: string) => unknown;
};

declare global { var TideSim: SimModule; }
import './sim.js';
export const TideSim = globalThis.TideSim as SimModule;
