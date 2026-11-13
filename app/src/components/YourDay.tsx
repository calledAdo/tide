import { useEffect, useMemo, useState } from 'react';
import type { BoatView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import {
  formatTide,
  formatTideAmount,
  unitsToNumber,
  TIDE_DECIMALS,
} from '../lib/format';
import { ReseedContributionForm } from './ReckoningPanel';
import {
  boatCanFishAtSeason,
  RunAction,
  seaPhase,
  seconds,
  useSeasonClock,
} from './shared';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
  wreckReport?: { burned: string; returned: string } | null;
};

type FishingPanelProps = {
  boat: BoatView;
  effort: number;
  fairEffort: number;
  fair: number;
  fullCatch: number;
  fullFuel: number;
  walletBalance: string;
  disabled: boolean;
  onEffort: (effort: number) => void;
  onFish: () => void;
  recovering: boolean;
};

function FishingPanel({
  boat,
  effort,
  fairEffort,
  fair,
  fullCatch,
  fullFuel,
  walletBalance,
  disabled,
  onEffort,
  onFish,
  recovering,
}: FishingPanelProps) {
  const preview = fullCatch * effort / 100;
  const afterTax = recovering ? preview * 0.5 : preview;
  const fuel = fullFuel * effort / 100;
  const over = fair > 0 ? preview / fair : 0;
  const fuelRaw = BigInt(asString(boat.full_effort_fuel))
    * BigInt(effort) / 100n;
  const fuelTooMuch = fuelRaw > BigInt(walletBalance || '0');
  const walletTide = formatTide(walletBalance);
  const amber = effort > fairEffort;
  return (
    <div className={`effort-panel ${amber ? 'is-over' : ''} ${disabled ? 'is-disabled' : ''} ${
      recovering ? 'is-recovering' : ''
    }`}>
      <div className="effort-heading">
        <span>EFFORT</span>
        <b>{effort}%</b>
      </div>
      <div className="effort-control">
        <div className="effort-slider-wrap">
          <input
            aria-label="Fishing effort"
            type="range"
            min="1"
            max="100"
            value={effort}
            disabled={disabled}
            onChange={(event) => onEffort(Number(event.target.value))}
          />
          <i className="fair-tick" style={{ left: `${fairEffort}%` }} />
          <div className="effort-scale"><span>1%</span><span>100%</span></div>
          <p className="fair-label">FAIR SHARE · {fairEffort}%</p>
        </div>
        <div className="fuel-gauge" aria-label={`Fuel use ${effort}%`}>
          <div className="fuel-gauge-fill" style={{ height: `${effort}%` }} />
          <span>FUEL<br />{effort}%</span>
        </div>
      </div>
      <p className="fuel-rule">
        fuel = 0.002 × your stake × effort — burned, not paid to anyone. Twice the effort
        burns twice the fuel.
      </p>
      <div className="preview-grid effort-readout">
        <span>GROSS CATCH <b>{formatTideAmount(preview)} TIDE</b></span>
        {recovering && <span>YOU RECEIVE <b>{formatTideAmount(afterTax)} TIDE</b></span>}
        <span>FUEL <b>{formatTideAmount(fuel)} TIDE</b></span>
        <span>NET <b>{formatTideAmount(afterTax - fuel)} TIDE</b></span>
        <span>{over.toFixed(1)}× <b>YOUR SHARE</b></span>
      </div>
      {recovering && (
        <p className="recovery-tax-note">RECOVERY TAX · HALF OF GROSS CATCH IS BURNED</p>
      )}
      <p className={`consequence ${amber ? 'is-amber' : ''}`}>
        {amber
          ? 'You will be publicly indicted; captains can vote to banish you for 10 days.'
          : 'No indictment.'}
      </p>
      {fuelTooMuch && (
        <p className="wallet-note">
          you need {formatTideAmount(fuel)} TIDE of fuel; your wallet holds {walletTide}
        </p>
      )}
      <div className="fish-presets">
        <button
          className="fair-choice"
          disabled={disabled}
          aria-pressed={effort === fairEffort}
          onClick={() => onEffort(fairEffort)}
        >FISH FAIR</button>
        <button
          className="hard-choice"
          disabled={disabled}
          aria-pressed={effort === 100}
          onClick={() => onEffort(100)}
        >FISH HARD</button>
      </div>
      <button className="primary wide fish-button" disabled={disabled || fuelTooMuch} onClick={onFish}>
        FISH
      </button>
    </div>
  );
}

function seasonCountdown(
  target: number,
  season: number,
  secondsLeft: number,
  seasonLength: number,
): number {
  return Math.max(0, (target - season - 1) * seasonLength + secondsLeft);
}

function WreckReport({
  wallet,
  walletApi,
  snapshot,
  run,
  onRefresh,
  wreckReport,
}: Props) {
  return (
    <section className="your-day wreck-report">
      <p className="eyebrow">YOUR DAY · WRECK REPORT</p>
      <h2>YOUR BOAT IS WRECKED</h2>
      <div className="wreck-loss-grid">
        <div>
          <span>BURNED FOR EVER</span>
          <b>{wreckReport ? formatTide(wreckReport.burned) : 'SETTLING…'}</b>
        </div>
        <div>
          <span>RETURNED TO WALLET</span>
          <b>{wreckReport ? formatTide(wreckReport.returned) : 'SETTLING…'}</b>
        </div>
      </div>
      <p>Fishing resumes only after a reseed. The fleet has to fund the next sea together.</p>
      <ReseedContributionForm wallet={wallet} walletApi={walletApi} snapshot={snapshot}
        run={run} onRefresh={onRefresh} />
    </section>
  );
}

export function YourDay({
  wallet,
  walletApi,
  snapshot,
  onConnect,
  run,
  onRefresh,
  wreckReport,
}: Props) {
  const [effort, setEffort] = useState(50);
  const account = wallet.account;
  const boat = account ? snapshot.boats[account] : null;
  const sea = snapshot.sea;
  const phase = seaPhase(sea);
  const clock = useSeasonClock(sea);
  const hasBoat = Boolean(boat && Number(asString(boat.boat.stake)) > 0);
  const fair = unitsToNumber(asString(boat?.fair_share), TIDE_DECIMALS);
  const fullCatch = unitsToNumber(asString(boat?.full_effort_catch), TIDE_DECIMALS);
  const fullFuel = unitsToNumber(asString(boat?.full_effort_fuel), TIDE_DECIMALS);
  const fairEffort = Math.max(1, Math.min(100, Math.round(
    fair / Math.max(1, fullCatch) * 100,
  )));
  useEffect(() => {
    setEffort(fairEffort);
  }, [account, fairEffort]);
  const call = (label: string, method: string, args: Record<string, unknown> = {}) => run(
    label,
    async () => {
      const result = await walletApi.call(method, args);
      onRefresh();
      return result;
    },
  );
  const blocked = useMemo(() => {
    if (!sea) return 'LOADING THE SEA';
    if (phase === 'Wrecked') return 'WRECKED';
    if (sea.seasons_behind > 40) return 'SETTLE';
    if (boat?.exiled_until && boat.exiled_until > clock.season) return 'EXILED';
    if (boat?.boat.stake_season === clock.season) return 'RIGGING';
    if (boat?.boat.last_fished === clock.season) return 'FISHED';
    if (boat && !boat.can_fish_now
      && !boatCanFishAtSeason(boat, clock.season)) return 'BLOCKED';
    return '';
  }, [boat, clock.season, phase, sea]);
  const countdown = sea
    ? blocked === 'EXILED' && boat?.exiled_until
      ? seasonCountdown(boat.exiled_until, clock.season, clock.secondsLeft, sea.season_len_sec)
      : clock.secondsLeft
    : 0;
  const ready = Boolean(hasBoat && !blocked && boat
    && boatCanFishAtSeason(boat, clock.season));
  const fish = () => call('Fish', 'fish', { effort_bps: effort * 100 });
  const panel = (disabled: boolean) => (
    <FishingPanel
      boat={boat!}
      effort={effort}
      fairEffort={fairEffort}
      fair={fair}
      fullCatch={fullCatch}
      fullFuel={fullFuel}
      walletBalance={snapshot.playerBalance}
      disabled={disabled}
      onEffort={setEffort}
      onFish={fish}
      recovering={phase === 'Recovering'}
    />
  );

  if (!account) return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY</p>
      <h2>TAKE A BOAT OUT</h2>
      <p>
        Connect a captain&apos;s wallet to fish the shared sea, inspect rivals, and take part
        in the assembly.
      </p>
      <button className="primary wide" onClick={onConnect}>CONNECT METAMASK TO TAKE A BOAT OUT</button>
      <a className="watch-link" href="#/replay">WATCH THE REPLAY →</a>
    </section>
  );
  if (phase === 'Wrecked') return <WreckReport wallet={wallet} walletApi={walletApi}
    snapshot={snapshot} onConnect={onConnect} run={run} onRefresh={onRefresh}
    wreckReport={wreckReport} />;
  if (sea && sea.seasons_behind > 40) return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY · SETTLEMENT</p>
      <h2>SETTLE THE SEA</h2>
      <p>The chain is more than 40 days behind. Settle before taking another action.</p>
      <button className="primary wide" onClick={() => call('Settle the sea', 'tick')}>
        TICK · SETTLE THE SEA
      </button>
    </section>
  );
  if (boat?.exiled_until && boat.exiled_until > clock.season) return (
    <section className="your-day exiled-card" role="status" aria-live="polite">
      <p className="eyebrow">YOUR DAY · EXILE</p>
      <h2>EXILED · RELEASE IN {seconds(countdown)}</h2>
      <p>Voted out in cycle {boat.boat.indicted_cycle ?? '—'}. You cannot fish, unstake,
        transfer, or vote.</p>
      {panel(true)}
    </section>
  );
  if (!hasBoat) return (
    <section className="your-day">
      <p className="eyebrow">TODAY · BLOCKED</p>
      <h2>YOUR BOAT IS DOCKED</h2>
      <p>Launch a hull in THE HULL below. It fishes from tomorrow; staking more upgrades this hull.</p>
    </section>
  );
  if (blocked === 'RIGGING') return (
    <section className="your-day rigging-card" role="status" aria-live="polite">
      <p className="eyebrow">TODAY · BOAT STATUS</p>
      <h2>YOUR BOAT IS RIGGING · READY IN {seconds(countdown)}</h2>
      <div className="rigging-progress"><i style={{
        width: `${Math.max(0, Math.min(
          100,
          100 - countdown / Math.max(1, sea?.season_len_sec ?? 1) * 100,
        ))}%`,
      }} /></div>
      <p>A boat cannot fish on the day it is launched or upgraded.</p>
      {panel(true)}
    </section>
  );
  if (blocked === 'FISHED') return (
    <section className="your-day" role="status" aria-live="polite">
      <p className="eyebrow">YOUR DAY · CATCH LANDED</p>
      <h2>NEXT TRIP IN {seconds(countdown)}</h2>
      <p>Your catch is in the water. Come back next season.</p>
      {panel(true)}
    </section>
  );
  if (!ready) return (
    <section className="your-day" role="status" aria-live="polite">
      <p className="eyebrow">TODAY · BLOCKED</p>
      <h2>YOUR BOAT IS WAITING</h2>
      <p>The contract has not marked this boat ready to fish yet.</p>
      {panel(true)}
    </section>
  );
  return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY · READY</p>
      <h2>YOUR BOAT IS READY · FISH NOW</h2>
      {panel(false)}
    </section>
  );
}
