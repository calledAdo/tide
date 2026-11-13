import type { HistoryPoint, SeaView } from '../near/types';
import { asString } from '../near/types';
import { compactNumber, formatTide } from '../lib/format';

type SeaReadoutProps = {
  sea: SeaView | null;
  history: HistoryPoint[];
};

export function SeaReadout({ sea, history }: SeaReadoutProps) {
  const stock = Number(asString(sea?.stock_fish));
  const caught = Number(asString(sea?.caught_this_season));
  const quota = Math.max(1, Number(asString(sea?.quota_per_season)));
  const minted = formatTide(asString(sea?.minted_catch));
  const burned = formatTide(asString(sea?.burned_fuel));

  return (
    <>
      <div className="sea-readout">
        <div>
          <span>STOCK</span>
          <strong>{compactNumber(stock)}</strong>
          <small>FISH</small>
        </div>
        <div>
          <span>TODAY&apos;S CATCH</span>
          <strong>{compactNumber(caught)}</strong>
          <div className="quota-track">
            <i style={{ width: `${Math.min(100, (caught / quota) * 100)}%` }} />
          </div>
          <small>QUOTA {compactNumber(quota)}</small>
        </div>
        <div>
          <span>MINTED / BURNED</span>
          <strong>
            {minted.replace(' TIDE', '')} / {burned.replace(' TIDE', '')}
          </strong>
          <small>TIDE</small>
        </div>
      </div>
      <StockHistory history={history} />
    </>
  );
}

function StockHistory({ history }: { history: HistoryPoint[] }) {
  const data = history.slice(-50);
  const max = Math.max(1, ...data.map((point) => point.stock));
  const path = data
    .map((point, index) => {
      const x = data.length === 1 ? 150 : (index / (data.length - 1)) * 280 + 10;
      const y = 72 - (point.stock / max) * 62;
      return `${index ? 'L' : 'M'}${x} ${y}`;
    })
    .join(' ');

  return (
    <div className="sparkline">
      <span>STOCK HISTORY</span>
      {data.length < 2 ? (
        <small>HISTORY BUILDS ONE POINT PER SEASON</small>
      ) : (
        <svg viewBox="0 0 300 80" aria-label="Stock history">
          <path d={path} />
        </svg>
      )}
    </div>
  );
}
