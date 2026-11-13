import type { HistoryPoint, SeaView } from '../near/types';
import { asString } from '../near/types';
import { compactNumber, formatTide } from '../lib/format';

export function SeaHealth({ sea, history }: { sea: SeaView | null; history: HistoryPoint[] }) {
  const stock = Number(asString(sea?.stock_fish));
  const msy = Math.max(1, Number(asString(sea?.msy_stock)));
  const caught = Number(asString(sea?.caught_this_season));
  const quota = Math.max(1, Number(asString(sea?.quota_per_season)));
  const data = history.slice(-40);
  const max = Math.max(1, ...data.map((point) => point.stock));
  const path = data.map((point, index) => {
    const x = data.length < 2 ? 150 : 8 + (index / (data.length - 1)) * 284;
    return `${index ? 'L' : 'M'}${x} ${74 - (point.stock / max) * 64}`;
  }).join(' ');
  return (
    <section className="sea-health" aria-label="Sea health">
      <div className="health-heading">
        <p className="eyebrow">SEA HEALTH</p>
        <b>{sea?.dead ? 'NO RECOVERY' : 'SUSTAINABILITY MONITOR'}</b>
      </div>
      <div className="health-grid">
        <div>
          <span>STOCK</span><strong>{compactNumber(stock)}</strong>
          <small>{Math.round((stock / msy) * 100)}% OF SUSTAINABLE LEVEL</small>
        </div>
        <div>
          <span>TODAY&apos;S FLEET CATCH / QUOTA</span>
          <strong>{compactNumber(caught)} / {compactNumber(quota)}</strong>
          <div className="quota-track">
            <i style={{ width: `${Math.min(100, caught / quota * 100)}%` }} />
          </div>
        </div>
        <div>
          <span>MINTED / BURNED</span>
          <strong>
            {formatTide(asString(sea?.minted_catch)).replace(' TIDE', '')} /
            {' '}{formatTide(asString(sea?.burned_fuel)).replace(' TIDE', '')}
          </strong>
          <small>TIDE IN THE WATER</small>
        </div>
        <div className="health-chart">
          <span>STOCK HISTORY</span>
          {data.length > 1
            ? <svg viewBox="0 0 300 80" aria-label="Stock history"><path d={path} /></svg>
            : <small>HISTORY BUILDS ONE POINT PER DAY</small>}
        </div>
      </div>
    </section>
  );
}
