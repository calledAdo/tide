import { useEffect, useState } from 'react';
import type { BoatView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import {
  historyApi,
  indictmentOverShare,
  tripIndictmentRatio,
  tripIsIndicted,
  type BoatHistory,
} from '../near/history';
import { formatTide } from '../lib/format';
import { shortName } from './shared';
import { readBotAccounts } from '../near/bots';

type Props = {
  account: string;
  boat: BoatView | null;
  snapshot: TideSnapshot;
  onClose: () => void;
};

export function CaptainCard({ account, boat, snapshot, onClose }: Props) {
  const [bots, setBots] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<BoatHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void readBotAccounts().then((items) => { if (live) setBots(items); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    void historyApi.boat(account).then((data) => {
      if (live) setHistory(data);
    }).catch(() => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [account]);
  const exile = snapshot.exiles.find(([name]) => name === account)?.[1] ?? boat?.exiled_until;
  const indicted = snapshot.indictments.some(([name]) => name === account);
  const stake = Number(asString(boat?.boat.stake));
  const tier = stake >= 1_000_000e18 ? 'FACTORY SHIP' : stake >= 50_000e18 ? 'TRAWLER' : 'DINGHY';
  const latest = history?.trips.at(-1);
  const indictmentTrip = history?.trips.find((trip) => (
    Math.floor(trip.season / 3) === boat?.boat.indicted_cycle
      && tripIsIndicted(trip, history.indictments)
  ));
  const currentOverShare = snapshot.indictments.find(([name]) => name === account)?.[1];
  const overShare = boat?.boat.indicted_cycle !== null && boat?.boat.indicted_cycle !== undefined
    ? (currentOverShare !== undefined ? asString(currentOverShare) : undefined)
      ?? (history && indictmentOverShare(history, boat.boat.indicted_cycle))
      ?? (indictmentTrip
          ? Math.max(0, Number(indictmentTrip.catch) - Number(indictmentTrip.fairShare))
          : 0)
    : 0;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="captain-card" role="dialog" aria-modal="true" aria-labelledby="captain-title">
        <header className="drawer-head">
          <div>
            <p className="eyebrow">
              CAPTAIN CARD {bots.has(account) && <em className="bot-tag">BOT</em>}
            </p>
            <h2 id="captain-title">{shortName(account)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close captain card">×</button>
        </header>
        <p className="account-code">{account}</p>
        {bots.has(account) && (
          <p className="bot-note">
            BOT · a demo captain run by the project&apos;s server; the contract treats it
            like any other account
          </p>
        )}
        <div className="captain-stats">
          <div><span>HULL</span><b>{tier}</b></div>
          <div><span>STAKE</span><b>{formatTide(asString(boat?.boat.stake))}</b></div>
          <div><span>TODAY&apos;S CATCH</span><b>{latest ? formatTide(latest.catch) : '—'}</b></div>
          <div><span>STATUS</span><b className={exile ? 'danger-text' : indicted ? 'amber-text' : ''}>
            {exile ? `EXILED UNTIL DAY ${exile}` : indicted ? 'INDICTED' : 'FAIR'}
          </b></div>
        </div>
        <section className="drawer-section">
          <h3>LAST 5 TRIPS</h3>
          {failed && <p className="history-note">History is catching up.</p>}
          {!failed && !history && <p className="history-note">Loading captain history…</p>}
          {history?.trips.slice(-5).reverse().map((trip) => (
            <div className="trip-line" key={`${trip.season}-${trip.tx ?? trip.ts ?? ''}`}>
              <span>DAY {trip.season}</span><b>{formatTide(trip.catch)}</b>
              <small>
                {trip.effortBps / 100}% effort · {tripIsIndicted(trip, history.indictments)
                  ? `INDICTED ${tripIndictmentRatio(trip)}`
                  : 'FAIR'}
              </small>
            </div>
          ))}
        </section>
        <section className="drawer-section">
          <h3>RECORD</h3>
          <p className="record-line">
            {history
              ? `${history.totals.trips ?? 0} trips · ${history.totals.indictments ?? 0}
                indictments · ${history.totals.exiles ?? 0} exiles`
              : 'History is catching up.'}
          </p>
          {indicted && boat?.boat.indicted_cycle !== null && boat?.boat.indicted_cycle !== undefined && (
            <p className="amber-note">
              +{formatTide(overShare)}
              over share in cycle {boat.boat.indicted_cycle}.
            </p>
          )}
        </section>
        <a className="secondary drawer-link" href="#/harbour" onClick={onClose}>OPEN HARBOUR ROW →</a>
      </aside>
    </div>
  );
}
