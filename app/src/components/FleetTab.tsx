import type { TideSnapshot } from '../near/types';
import { asString, boatHasStake } from '../near/types';
import { CONTRACT } from '../config';
import { formatTide } from '../lib/format';
import { boatStatus, shortName } from './shared';

export function FleetTab({ snapshot, account }: { snapshot: TideSnapshot; account?: string }) {
  const boats = Object.entries(snapshot.boats).filter(
    ([name, boat]) => name !== CONTRACT && boatHasStake(boat),
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
              {boatStatus(boat, snapshot.sea?.season ?? 0,
                snapshot.indictments.some(([item]) => item === name)).label}
            </span>
          </article>
        ) : null,
      )}
    </div>
  );
}
