import type { HistoryPoint, SeaView } from '../near/types';
import { asString } from '../near/types';
import { compactNumber } from '../lib/format';

type Future = { values: number[]; deadAt: number | null };

function future(
  stock: number,
  dailyEffort: number,
  capacity: number,
  allee: number,
  fairCatchAmount = 0,
): Future {
  const values: number[] = [];
  let current = stock;
  let deadAt: number | null = null;
  for (let day = 1; day <= 30; day += 1) {
    const catchAmount = fairCatchAmount > 0
      ? fairCatchAmount
      : Math.max(0, dailyEffort * 0.25 * current);
    const growth = 0.6 * current * (1 - current / capacity) * (current - allee) / capacity;
    current = Math.max(0, current - catchAmount + growth);
    values.push(current);
    if (current < allee && deadAt === null) deadAt = day;
  }
  return { values, deadAt };
}

function verdict(result: Future, current: number, allee: number): string {
  const last = result.values.at(-1) ?? current;
  if (result.deadAt !== null || last < allee * 1.35) return 'HEADING FOR COLLAPSE';
  if (last < current * 0.95) return 'STRAINED';
  return 'SUSTAINABLE';
}

function line(values: number[], max: number, start: number, end: number): string {
  return values.map((value, index) => {
    const x = start + (index / Math.max(1, values.length - 1)) * (end - start);
    const y = 72 - (value / max) * 62;
    return `${index ? 'L' : 'M'}${x} ${y}`;
  }).join(' ');
}

export function ProjectionPanel({ sea, history }: { sea: SeaView | null; history: HistoryPoint[] }) {
  if (!sea) return null;
  const stock = Number(asString(sea.stock_fish));
  const capacity = Math.max(1, Number(asString(sea.carrying_capacity)));
  const allee = Number(asString(sea.allee_threshold));
  const stake = Number(asString(sea.staked_total || sea.fleet_snapshot));
  const quota = Number(asString(sea.quota_per_season));
  const actualCatch = Number(asString(sea.caught_this_season));
  const actualEffort = quota > 0 ? Math.min(1.5, Math.max(0, actualCatch / quota)) : 0;
  const fairCatchAmount = quota * (stake > 0 ? 1 : 0);
  const share = future(stock, 0, capacity, allee, fairCatchAmount);
  const flat = future(stock, 1, capacity, allee);
  const actual = future(stock, actualEffort, capacity, allee);
  const data = history.slice(-30).map((point) => point.stock).concat([stock]);
  const max = Math.max(1, ...data, ...share.values, ...flat.values, ...actual.values);
  const start = data.length > 1 ? 8 + ((data.length - 1) / (data.length + 29)) * 270 : 8;
  const historyPath = line(data, max, 8, start);
  const projectionPath = (result: Future) => line([stock, ...result.values], max, start, 278);
  const report = (
    label: string,
    result: Future,
    showVerdict = false,
    forcedVerdict?: string,
  ) => (
    <div className="projection-report">
      <div><b>{label}</b>{showVerdict && <em>{forcedVerdict ?? verdict(result, stock, allee)}</em>}</div>
      <span>DAY 10 <strong>{compactNumber(result.values[9] ?? stock)}</strong></span>
      <span>DAY 30 <strong>{compactNumber(result.values[29] ?? stock)}</strong></span>
      {result.deadAt !== null && <small>THE SEA DIES ON DAY {result.deadAt}</small>}
    </div>
  );
  return (
    <aside className="projection-panel">
      <div className="projection-head">
        <p className="eyebrow">LOOKING AHEAD</p>
        <h2>THE FORK IN THE WATER</h2>
      </div>
      <div className="projection-chart">
        <svg viewBox="0 0 300 80" aria-label="Stock history and projections">
          <path className="projection-history" d={historyPath} />
          <path className="projection-share" d={projectionPath(share)} />
          <path className="projection-flat" d={projectionPath(flat)} />
          <path className="projection-actual" d={projectionPath(actual)} />
        </svg>
        <small>PAST · TODAY · 30 DAYS AHEAD</small>
      </div>
      {report('IF EVERY CAPTAIN FISHES THEIR SHARE', share, true, 'SUSTAINABLE')}
      {report('IF EVERY CAPTAIN FISHES FLAT OUT', flat)}
      {report("AT TODAY'S ACTUAL EFFORT", actual, true)}
      <p className="projection-caption">Projections use the same model as the replay.</p>
    </aside>
  );
}
