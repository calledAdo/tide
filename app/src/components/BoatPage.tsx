import { useEffect, useState } from 'react';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import {
  historyApi,
  tripIndictmentRatio,
  tripIsIndicted,
  type BoatHistory,
} from '../near/history';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import { tideAmountExceedsBalance, tideUnits } from '../config';
import { formatTide, compactNumber } from '../lib/format';
import { RunAction, shortName } from './shared';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function BoatPage({ wallet, walletApi, snapshot, onConnect, run, onRefresh }: Props) {
  const account = wallet.account;
  const boat = account ? snapshot.boats[account] : null;
  const [amount, setAmount] = useState('10000');
  const [history, setHistory] = useState<BoatHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!account) return undefined;
    let live = true;
    void historyApi.boat(account).then((data) => {
      if (live) setHistory(data);
    }).catch(() => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [account, snapshot.sea?.season]);
  const call = (label: string, method: string, args: Record<string, unknown>) => run(
    label,
    async () => {
      const result = await walletApi.call(method, args);
      onRefresh();
      return result;
    },
  );
  if (!account) return (
    <main className="route-page boat-page">
      <div className="empty-route">
        <p className="eyebrow">YOUR BOAT</p>
        <h1>NO CAPTAIN ON DECK</h1>
        <button className="primary" onClick={onConnect}>CONNECT METAMASK</button>
      </div>
    </main>
  );
  const stake = Number(asString(boat?.boat.stake));
  const amountTooMuch = tideAmountExceedsBalance(amount, snapshot.playerBalance);
  const nextTier = stake < 50_000e18 ? 'TRAWLER' : 'FACTORY SHIP';
  const step = stake < 50_000e18 ? 50_000 : 1_000_000;
  const progress = Math.min(100, stake / (step * 1e18) * 100);
  const blocked = boat?.exiled_until && boat.exiled_until > (snapshot.sea?.season ?? 0)
    ? 'EXILED'
    : snapshot.indictments.some(([name]) => name === account)
      ? 'INDICTED UNTIL ASSEMBLY CLOSES'
      : '';
  const tierCopy = stake >= 1_000_000e18
    ? 'FACTORY SHIP · MAX TIER'
    : `+${compactNumber(Math.max(0, step - stake / 1e18))} TIDE TO ${nextTier}`;
  return (
    <main className="route-page boat-page">
      <div className="route-heading">
        <div>
          <p className="eyebrow">CAPTAIN&apos;S LOG · {shortName(account)}</p>
          <h1>YOUR BOAT</h1>
        </div>
        <span>{blocked || 'ACTIVE HULL'}</span>
      </div>
      <section className="boat-actions">
        <div>
          <p className="eyebrow">LAUNCH / UPGRADE / DOCK</p>
          <h2>{boat ? 'UPGRADE THIS BOAT' : 'LAUNCH YOUR BOAT'}</h2>
          <p>
            {boat
              ? tierCopy
              : 'Your first stake launches one boat. A second boat needs another account.'}
          </p>
          <div className="tier-progress"><i style={{ width: `${progress}%` }} /></div>
          <label>
            AMOUNT
            <input
              value={amount}
              inputMode="numeric"
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          {amountTooMuch && (
            <p className="wallet-note">
              You have {formatTide(snapshot.playerBalance)} in your wallet
            </p>
          )}
          <button
            className="primary"
            disabled={Boolean(blocked) || !amount || amountTooMuch}
            onClick={() => call(
              boat ? 'Upgrade boat' : 'Launch your boat',
              'stake',
              { amount: tideUnits(amount).toString() },
            )}
          >
            {boat ? 'UPGRADE BOAT' : 'LAUNCH BOAT'}
          </button>
        </div>
        <div className="dock-action">
          <h3>DOCK</h3>
          <p>
            {blocked || (boat?.boat.last_fished === snapshot.sea?.season
              ? 'Built or fished today; return tomorrow.'
              : 'Return some or all of your stake.')}
          </p>
          <button
            className="secondary"
            disabled={!boat || Boolean(blocked)}
            onClick={() => call('Dock boat', 'unstake', {
              amount: asString(boat?.boat.stake),
            })}
          >
            DOCK FULL STAKE
          </button>
        </div>
      </section>
      <section className="captains-log">
        <div className="section-title">
          <div>
            <p className="eyebrow">IMMUTABLE RECORD</p>
            <h2>CAPTAIN&apos;S LOG</h2>
          </div>
          {failed && <small>HISTORY IS CATCHING UP</small>}
        </div>
        {!failed && !history && <p className="history-note">Loading history…</p>}
        {history && (
          <>
            <div className="log-totals">
              <b>{history.totals.trips ?? 0}<small>TRIPS</small></b>
              <b>{history.totals.indictments ?? 0}<small>INDICTMENTS</small></b>
              <b>{history.totals.exiles ?? 0}<small>EXILES</small></b>
              <b>{formatTide(history.totals.net ?? 0)}<small>NET</small></b>
            </div>
            <div className="trip-table">
              <div className="trip-head">
                <span>DAY</span><span>EFFORT</span><span>CATCH</span>
                <span>FUEL</span><span>NET</span><span>FAIR SHARE</span>
              </div>
              {history.trips.slice().reverse().map((trip) => {
                const indicted = tripIsIndicted(trip, history.indictments);
                return (
                  <div className="trip-head" key={`${trip.season}-${trip.tx ?? trip.ts ?? ''}`}>
                    <span>{trip.season}</span>
                    <span>{trip.effortBps / 100}%</span>
                    <span>{formatTide(trip.catch)}</span>
                    <span>{formatTide(trip.fuel)}</span>
                    <span>{formatTide(Number(trip.catch) - Number(trip.fuel))}</span>
                    <span>
                      {formatTide(trip.fairShare)}
                      {indicted && ` · INDICTED ${tripIndictmentRatio(trip)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
