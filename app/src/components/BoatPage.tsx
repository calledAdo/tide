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
import { callWithStorageRegistration, type StorageClient } from '../near/registration';
import { tideAmountExceedsBalance, tideUnits } from '../config';
import { compactNumber, formatTide } from '../lib/format';
import { RunAction, seaPhase, seconds, shortName, useSeasonClock } from './shared';
import { YourDay } from './YourDay';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  tideClient: StorageClient;
  snapshot: TideSnapshot;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
};

function hull(stake: number): string {
  return stake >= 1_000_000e18 ? 'FACTORY SHIP' : stake >= 50_000e18 ? 'TRAWLER' : 'DINGHY';
}

export function BoatPage({
  wallet,
  walletApi,
  tideClient,
  snapshot,
  onConnect,
  run,
  onRefresh,
}: Props) {
  const account = wallet.account;
  const boat = account ? snapshot.boats[account] : null;
  const [amount, setAmount] = useState('10000');
  const [history, setHistory] = useState<BoatHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [wreckReport, setWreckReport] = useState<{ burned: string; returned: string } | null>(null);
  const [actionProgress, setActionProgress] = useState('');
  const clock = useSeasonClock(snapshot.sea);
  useEffect(() => {
    if (!account) return undefined;
    let live = true;
    void historyApi.boat(account).then((data) => {
      if (live) setHistory(data);
    }).catch(() => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [account, snapshot.sea?.season, snapshot.sea?.phase]);
  useEffect(() => {
    if (!account || seaPhase(snapshot.sea) !== 'Wrecked') {
      setWreckReport(null);
      return undefined;
    }
    let live = true;
    void historyApi.events(
      `?event=boat_wrecked&account=${encodeURIComponent(account)}&limit=20`,
    ).then((events) => {
      const event = events.find((item) => item.data?.account === account);
      const burned = event?.data?.burned;
      const returned = event?.data?.returned;
      if (live && (typeof burned === 'string' || typeof burned === 'number')
        && (typeof returned === 'string' || typeof returned === 'number')) {
        setWreckReport({ burned: String(burned), returned: String(returned) });
      }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [account, snapshot.sea?.phase, snapshot.reckoning?.wreck_season]);
  const call = (label: string, method: string, args: Record<string, unknown>) => run(
    label,
    async () => {
      if (!account) throw new Error('Connect MetaMask first.');
      const result = method === 'stake'
        ? await callWithStorageRegistration(
          walletApi,
          tideClient,
          account,
          { method, args, progress: 'Staking…' },
          setActionProgress,
        )
        : await walletApi.call(method, args);
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
  const hasBoat = Boolean(boat && stake > 0);
  const nextTier = stake < 50_000e18 ? 'TRAWLER' : 'FACTORY SHIP';
  const nextStake = stake < 50_000e18 ? 50_000 : 1_000_000;
  const progress = hasBoat ? Math.min(100, stake / (nextStake * 1e18) * 100) : 0;
  const amountTooMuch = tideAmountExceedsBalance(amount, snapshot.playerBalance);
  const currentSeason = clock.season;
  const phase = seaPhase(snapshot.sea);
  const exiled = boat?.exiled_until && boat.exiled_until > currentSeason;
  const indicted = snapshot.indictments.some(([name]) => name === account);
  const blocked = exiled
    ? `EXILED UNTIL DAY ${boat?.exiled_until}`
    : phase === 'Wrecked' ? 'SEA WRECKED'
    : indicted ? 'INDICTED UNTIL ASSEMBLY CLOSES'
    : boat?.boat.stake_season === currentSeason ? 'BUILT TODAY' : '';
  const latest = history?.trips.at(-1);
  const fair = Number(asString(boat?.fair_share));
  const fullCatch = Number(asString(boat?.full_effort_catch));
  const fairEffort = fullCatch > 0 ? Math.max(1, Math.round(fair / fullCatch * 100)) : 0;
  const fullFuelRaw = BigInt(asString(boat?.full_effort_fuel));
  const nextFuelRaw = latest?.season === currentSeason
    ? BigInt(String(latest.fuel))
    : fullFuelRaw * BigInt(fairEffort) / 100n;
  const walletTide = formatTide(snapshot.playerBalance);
  const boatTide = formatTide(asString(boat?.boat.stake));
  const standing = history?.trips.reduce((total, trip) => total + Number(trip.catch), 0) ?? 0;
  const rank = Object.values(snapshot.boats).filter(Boolean).filter((item) => item)
    .filter((item) => Number(asString(item?.boat.stake)) > 0).length;
  return (
    <main className="route-page boat-page">
      <div className="route-heading">
        <div><p className="eyebrow">CAPTAIN&apos;S LOG · {shortName(account)}</p><h1>YOUR BOAT</h1></div>
        <span>{blocked || 'ACTIVE HULL'}</span>
      </div>
      <section className="boat-today">
        <div className="section-title">
          <div><p className="eyebrow">01 · TODAY</p><h2>THE FISHING DECISION</h2></div>
        </div>
        <YourDay wallet={wallet} walletApi={walletApi} snapshot={snapshot} onConnect={onConnect}
          run={run} onRefresh={onRefresh} wreckReport={wreckReport} />
      </section>
      <section className="boat-section maintenance-section">
        <p className="eyebrow">02 · MAINTENANCE</p>
        <h2>KEEP THE BOAT MOVING</h2>
        <p>Every trip burns fuel in proportion to effort. Fuel is burned, not paid to anyone.</p>
        <div className="maintenance-grid">
          <div><span>TODAY&apos;S FUEL COST</span><b>{formatTide(nextFuelRaw.toString())}</b></div>
          <div><span>WALLET TIDE</span><b>{walletTide}</b></div>
          <div><span>BOAT TIDE</span><b>{boatTide}</b></div>
        </div>
        {BigInt(snapshot.playerBalance || '0') < nextFuelRaw && (
          <p className="wallet-note">Your wallet cannot cover the next trip&apos;s fuel.</p>
        )}
      </section>
      <section className="boat-section hull-section">
        <p className="eyebrow">03 · THE HULL</p>
        <h2>{hasBoat ? hull(stake) : 'LAUNCH A HULL'}</h2>
        {hasBoat && <>
          <p>{compactNumber(Math.max(0, nextStake - stake / 1e18))} TIDE TO {nextTier}</p>
          <div className="tier-progress"><i style={{ width: `${progress}%` }} /></div>
        </>}
        <label className="amount-field">
          AMOUNT
          <input
            value={amount}
            inputMode="numeric"
            onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
          />
        </label>
        {amountTooMuch && <p className="wallet-note">You have {walletTide} in your wallet.</p>}
        <div className="hull-actions">
          <button
            className="primary"
            disabled={!amount || amountTooMuch || Boolean(blocked)}
            onClick={() => call(
              hasBoat ? 'Upgrade boat' : 'Launch your boat',
              'stake',
              { amount: tideUnits(amount).toString() },
            )}
          >
            {hasBoat ? 'UPGRADE' : 'LAUNCH'}
          </button>
          <button
            className="secondary"
            disabled={!hasBoat || Boolean(blocked)}
            onClick={() => call(
              'Dock boat',
              'unstake',
              { amount: asString(boat?.boat.stake) },
            )}
          >DOCK</button>
        </div>
        {actionProgress && <p className="wallet-note" role="status">{actionProgress}</p>}
        <p className="hull-warning">upgrading pauses fishing until tomorrow</p>
        {blocked && <p className="blocked-reason">BLOCKED · {blocked}</p>}
      </section>
      <section className="boat-section standing-section">
        <p className="eyebrow">04 · STANDING</p>
        <h2>YOUR RECORD ON THE WATER</h2>
        <div className="standing-grid">
          <div><span>INDICTMENTS</span><b>{history?.totals.indictments ?? 0}</b></div>
          <div><span>EXILE</span><b>{exiled ? `UNTIL DAY ${boat?.exiled_until}` : 'NONE'}</b></div>
          <div><span>RANK BY CATCH</span><b>{standing ? `TOP ${Math.max(1, rank)}` : 'CATCHING UP'}</b></div>
        </div>
        {exiled && snapshot.sea && (
          <p className="blocked-reason">
            RELEASE IN {seconds(Math.max(0,
              ((boat?.exiled_until ?? currentSeason) - currentSeason - 1)
              * snapshot.sea.season_len_sec + clock.secondsLeft))}
          </p>
        )}
      </section>
      <section className="captains-log">
        <div className="section-title">
          <div><p className="eyebrow">05 · IMMUTABLE RECORD</p><h2>CAPTAIN&apos;S LOG</h2></div>
          {failed && <small>HISTORY IS CATCHING UP</small>}
        </div>
        {!failed && !history && <p className="history-note">Loading history…</p>}
        {history && <>
          <div className="log-totals">
            <b>{history.totals.trips ?? 0}<small>TRIPS</small></b>
            <b>{history.totals.indictments ?? 0}<small>INDICTMENTS</small></b>
            <b>{history.totals.exiles ?? 0}<small>EXILES</small></b>
            <b>{formatTide(history.totals.net ?? 0)}<small>NET</small></b>
          </div>
          <div className="trip-table">
            <div className="trip-head">
              <span>DAY</span><span>EFFORT</span><span>CATCH</span><span>FUEL</span>
              <span>NET</span><span>FAIR SHARE</span>
            </div>
            {history.trips.slice().reverse().map((trip) => {
              const indicted = tripIsIndicted(trip, history.indictments);
              return <div className="trip-head" key={`${trip.season}-${trip.tx ?? trip.ts ?? ''}`}>
                <span>{trip.season}</span><span>{trip.effortBps / 100}%</span>
                <span>{formatTide(trip.catch)}</span><span>{formatTide(trip.fuel)}</span>
                <span>{formatTide(Number(trip.catch) - Number(trip.fuel))}</span>
                <span>{formatTide(trip.fairShare)}
                  {indicted && ` · INDICTED ${tripIndictmentRatio(trip)}`}
                </span>
              </div>;
            })}
          </div>
        </>}
      </section>
    </main>
  );
}
