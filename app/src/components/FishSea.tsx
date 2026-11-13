import type { SeaView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { compactNumber } from '../lib/format';
import { shortName } from './shared';

type Props = {
  sea: SeaView | null;
  snapshot: TideSnapshot;
  account?: string;
  onSelect: (account: string) => void;
};

function tier(stake: number): 'dinghy' | 'trawler' | 'factory' {
  return stake >= 1_000_000e18 ? 'factory' : stake >= 50_000e18 ? 'trawler' : 'dinghy';
}

export function FishSea({ sea, snapshot, account, onSelect }: Props) {
  const stock = Number(asString(sea?.stock_fish));
  const fishCount = Math.max(4, Math.min(50, Math.round(stock / 20_000)));
  const boats = Object.entries(snapshot.boats).filter(([name, boat]) => {
    const until = snapshot.exiles.find(([item]) => item === name)?.[1] ?? boat?.exiled_until;
    if (!boat || Number(asString(boat.boat.stake)) <= 0) return false;
    return until === undefined || until === null || until <= (sea?.season ?? 0);
  });
  const exiled = new Map(snapshot.exiles);
  const capacity = Math.max(1, Number(asString(sea?.carrying_capacity)));
  const depth = Math.max(5, Math.min(94, 100 - stock / capacity * 100));
  const activeExiles = [...exiled.entries()].filter(([, until]) => until > (sea?.season ?? 0));
  const visibleBoats = boats.slice(0, 18);
  return (
    <section className={`sea-wrap ${sea?.dead ? 'dead-sea' : ''}`}>
      <div className="sea-heading">
        <div><p className="eyebrow">$TIDE · SHARED WATER</p><h1>THE SEA</h1></div>
        <div className="sea-heading-status">
          <span className="sea-state">{sea?.dead ? 'EXTINCT' : 'LIVE FLEET'}</span>
          {snapshot.stale && <span className="sea-stale">STALE</span>}
        </div>
      </div>
      <div className="sea-visual">
        <svg viewBox="0 0 820 360" role="img" aria-label="The live shared sea with rival boats">
          <path className="waterline" d="M0 48 Q80 30 160 48 T320 48 T480 48 T640 48 T820 48" />
          <path className="water-band" d="M0 54 H820 V360 H0Z" />
          {Array.from({ length: fishCount }, (_, index) => (
            <g key={`fish-${index}`} transform={`translate(${35 + index * 137 % 750}
              ${80 + index * 67 % 235})`}>
              <path className="fish-glyph" d="M0 4C3 0 9 0 12 4C9 8 3 8 0 4ZM12 4L16 0V8Z" />
            </g>
          ))}
          {visibleBoats.map(([name, boat], index) => {
            if (!boat) return null;
            const stake = Number(asString(boat.boat.stake));
            const kind = tier(stake);
            const indicted = snapshot.indictments.some(([item]) => item === name);
            const isYou = name === account;
            const catching = boat.boat.last_fished === sea?.season;
            const x = visibleBoats.length === 1
              ? 35
              : 24 + (index / (visibleBoats.length - 1)) * 700;
            return <g
              key={name}
              className={`boat-glyph ${kind} ${isYou ? 'you' : ''} ${catching ? 'catching' : ''}`}
              transform={`translate(${x}, 40)`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(name);
              }}
              aria-label={`Inspect ${name}`}
            >
              <text x="0" y="-10">{shortName(name)}</text>
              <path d={kind === 'factory'
                ? 'M0 0h58l-8 14H8z'
                : kind === 'trawler' ? 'M0 1h45l-7 12H7z' : 'M0 2h31l-6 10H5z'} />
              {isYou && <text className="you-pennant" x="6" y="-20">YOU</text>}
              {indicted && <text className="flag" x="32" y="-18">
                ⚑ {Math.max(1, Number(asString(boat.full_effort_catch))
                  / Math.max(1, Number(asString(boat.fair_share)))).toFixed(1)}×
              </text>}
            </g>;
          })}
          <g className="exile-island" transform="translate(-638 0)">
            <path d="M674 305q30-35 80 0l-8 15h-78z" />
            <path d="M700 301l8-33 12 33M713 286l19-12" />
            <text x="672" y="342">EXILE ISLAND</text>
            <text x="672" y="352">UNTIL DAY {activeExiles[0]?.[1] ?? '—'}</text>
            {[0, 1, 2].map((index) => (
              <path
                key={index}
                className="beached-boat"
                d={`M${685 + index * 27} ${311 - index % 2 * 5}h20l-4 5h-13z`}
              />
            ))}
          </g>
          <line className="catch-line" x1="50" y1="54" x2="92" y2="260" />
        </svg>
        <div className="depth-gauge">
          <span className="gauge-top">
            SUSTAINABLE<br /><b>{compactNumber(Number(asString(sea?.msy_stock)))}</b>
          </span>
          <i style={{ top: `${depth}%` }} />
          <span className="gauge-bottom">
            POINT OF<br />NO RETURN<br />
            <b>{compactNumber(Number(asString(sea?.allee_threshold)))}</b>
          </span>
        </div>
        {sea?.dead && <div className="death-stamp">THE SEA<br />IS DEAD</div>}
      </div>
      <div className="sea-caption">
        {boats.length} BOATS ON THE WATER · {activeExiles.length} ON EXILE ISLAND · CLICK A HULL
        TO INSPECT ITS CAPTAIN
      </div>
    </section>
  );
}
