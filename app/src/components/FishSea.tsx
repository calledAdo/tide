import type { TideSnapshot, SeaView } from '../near/types';
import { asString } from '../near/types';
import { compactNumber } from '../lib/format';
import { shortName } from './shared';
import { SeaReadout } from './SeaReadout';

type FishSeaProps = {
  sea: SeaView | null;
  snapshot: TideSnapshot;
  account?: string;
};

export function FishSea({ sea, snapshot, account }: FishSeaProps) {
  const stock = Number(asString(sea?.stock_fish));
  const fishCount = Math.max(4, Math.min(50, Math.round(stock / 20_000)));
  const boats = Object.entries(snapshot.boats).filter(
    ([, boat]) => boat && Number(asString(boat.boat.stake)) > 0,
  );
  const exiled = new Map(snapshot.exiles);
  const carryingCapacity = Math.max(1, Number(asString(sea?.carrying_capacity)));
  const depth = Math.max(5, Math.min(94, 100 - (stock / carryingCapacity) * 100));

  return (
    <div className={`sea-wrap ${sea?.dead ? 'dead-sea' : ''}`}>
      <div className="sea-heading">
        <div>
          <p className="eyebrow">$TIDE · LIVE WATER</p>
          <h1>THE SEA</h1>
        </div>
        <span className="sea-state">{sea?.dead ? 'EXTINCT' : 'STOCK IN MOTION'}</span>
      </div>
      <div className="sea-visual">
        <svg viewBox="0 0 820 330" role="img" aria-label="Animated fish stock and fleet">
          <path className="waterline" d="M0 43 Q80 26 160 43 T320 43 T480 43 T640 43 T820 43" />
          <path className="water-band" d="M0 50 H820 V330 H0Z" />
          {Array.from({ length: fishCount }, (_, index) => (
            <g
              key={`fish-${index}`}
              transform={`translate(${35 + (index * 137) % 750} ${72 + (index * 67) % 210})`}
            >
              <g
                className="fish-glyph"
                style={{ animationDelay: `${(index % 9) * -0.7}s` }}
              >
                <path d="M0 4C3 0 9 0 12 4C9 8 3 8 0 4ZM12 4L16 0V8Z" />
              </g>
            </g>
          ))}
          {boats.slice(0, 12).map(([name, boat], index) => {
            if (!boat) return null;
            const until = exiled.get(name);
            const indicted = boat.boat.indicted_cycle !== null;
            return (
              <g
                key={name}
                className={`boat-glyph ${name === account ? 'you' : ''}`}
                transform={`translate(${34 + (index * 91) % 730}, ${index % 3 === 0 ? 30 : 39})`}
              >
                <path d="M0 0h42l-7 10H8z" />
                <text x="0" y="-7">{shortName(name)}</text>
                {indicted && <text className="flag" x="26" y="-17">⚑</text>}
                {until && until > (sea?.season ?? 0) && (
                  <text className="exile-tag" x="4" y="25">
                    EXILE S{until}
                  </text>
                )}
              </g>
            );
          })}
          <line className="catch-line" x1="50" y1="50" x2="92" y2="238" />
        </svg>
        <div className="depth-gauge">
          <span className="gauge-top">
            SUSTAINABLE
            <br />
            <b>{compactNumber(Number(asString(sea?.msy_stock)))}</b>
          </span>
          <i style={{ top: `${depth}%` }} />
          <span className="gauge-bottom">
            POINT OF
            <br />
            NO RETURN
            <br />
            <b>{compactNumber(Number(asString(sea?.allee_threshold)))}</b>
          </span>
        </div>
        {sea?.dead && <div className="death-stamp">THE SEA<br />IS DEAD</div>}
      </div>
      <SeaReadout sea={sea} history={snapshot.history} />
    </div>
  );
}
