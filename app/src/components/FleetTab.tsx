import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { formatTide } from '../lib/format';
import { shortName } from './shared';

export function FleetTab({ snapshot, account }: { snapshot: TideSnapshot; account?: string }) {
  const boats = Object.entries(snapshot.boats).filter(
    ([, boat]) => boat && Number(asString(boat.boat.stake)) > 0,
  );

  return (
    <div className="fleet-grid">
      {boats.map(([name, boat]) =>
        boat ? (
          <article key={name} className="fleet-card">
            <div>
              <b>{shortName(name)}</b>
              {name === account && <em>YOU</em>}
            </div>
            <strong>{formatTide(asString(boat.boat.stake))}</strong>
            <span>
              {boat.boat.indicted_cycle !== null
                ? 'INDICTED'
                : boat.exiled_until
                  ? `EXILED UNTIL S${boat.exiled_until}`
                  : 'FAIR'}
            </span>
          </article>
        ) : null,
      )}
    </div>
  );
}
