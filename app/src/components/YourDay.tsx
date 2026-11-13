import { useMemo, useState } from 'react';
import { tideAmountExceedsBalance, tideUnits } from '../config';
import type { BoatView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import {
  compactNumber,
  formatTide,
  formatTideAmount,
  unitsToNumber,
  TIDE_DECIMALS,
} from '../lib/format';
import { assemblyStage, RunAction, seconds } from './shared';
import { AssemblyTakeover } from './AssemblyTakeover';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  onOpenWallet: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function YourDay({ wallet, walletApi, snapshot, onConnect, onOpenWallet, run, onRefresh }: Props) {
  const [amount, setAmount] = useState('10000');
  const [effort, setEffort] = useState(50);
  const [custom, setCustom] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const account = wallet.account;
  const boat = account ? snapshot.boats[account] : null;
  const sea = snapshot.sea;
  const stage = assemblyStage(sea, snapshot.assembly);
  const hasBoat = Boolean(boat && Number(asString(boat.boat.stake)) > 0);
  const hasTide = BigInt(snapshot.playerBalance || '0') > 0n;
  const amountTooMuch = tideAmountExceedsBalance(amount, snapshot.playerBalance);
  const fair = unitsToNumber(asString(boat?.fair_share), TIDE_DECIMALS);
  const fullCatch = unitsToNumber(asString(boat?.full_effort_catch), TIDE_DECIMALS);
  const fullFuel = unitsToNumber(asString(boat?.full_effort_fuel), TIDE_DECIMALS);
  const fairEffort = Math.max(1, Math.min(100, Math.round((fair / Math.max(1, fullCatch)) * 100)));
  const selectedEffort = custom ? effort : fairEffort;
  const preview = fullCatch * selectedEffort / 100;
  const fuel = fullFuel * selectedEffort / 100;
  const over = fair > 0 ? preview / fair : 0;
  const hardOver = fair > 0 ? fullCatch / fair : 0;
  const call = (label: string, method: string, args: Record<string, unknown> = {}) => run(label, async () => {
    const result = await walletApi.call(method, args);
    onRefresh();
    return result;
  });
  const blocked = useMemo(() => {
    if (!sea) return 'LOADING THE SEA';
    if (sea.dead) return 'DEAD';
    if (sea.seasons_behind > 40) return 'SETTLE';
    if (boat?.exiled_until && boat.exiled_until > sea.season) return `EXILED UNTIL DAY ${boat.exiled_until}`;
    if (boat?.boat.stake_season === sea.season) return 'BUILT TODAY';
    if (boat?.boat.last_fished === sea.season) return 'FISHED';
    return '';
  }, [boat, sea]);
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
  if (sea?.dead) return (
    <section className="your-day dead-card">
      <p className="eyebrow">YOUR DAY</p>
      <h2>THE SEA IS DEAD</h2>
      <div className="death-stamp small-stamp">NO MORE FISHING</div>
      <p>The stock crossed the point of no return. There are no more trips to take.</p>
    </section>
  );
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
  if (boat?.exiled_until && sea && boat.exiled_until > sea.season) return (
    <section className="your-day exiled-card">
      <p className="eyebrow">YOUR DAY · EXILE</p>
      <h2>EXILED UNTIL DAY {boat.exiled_until}</h2>
      <p>Voted out in cycle {boat.boat.indicted_cycle ?? '—'}. You cannot fish, unstake,
        transfer, or vote.</p>
      <div className="next-season">
        RELEASE IN <b>{seconds(Math.max(0, (boat.exiled_until - sea.season)
          * sea.season_len_sec + sea.seconds_left_in_season))}</b>
      </div>
    </section>
  );
  if (stage && snapshot.assembly) return (
    <section className="your-day assembly-day">
      <AssemblyTakeover wallet={wallet} walletApi={walletApi} snapshot={snapshot}
        onConnect={onConnect} selected={selected} setSelected={setSelected}
        run={run} onRefresh={onRefresh} />
    </section>
  );
  if (!hasBoat) return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY · FIRST STAKE</p>
      <h2>LAUNCH<br />YOUR BOAT</h2>
      <p>One account, one boat. It fishes from tomorrow; staking more upgrades this hull.</p>
      <div className="stake-presets">
        {([['10000', 'DINGHY'], ['50000', 'TRAWLER'], ['1000000', 'FACTORY SHIP']] as const)
          .map(([value, tier]) => (
            <button
              key={value}
              aria-pressed={amount === value}
              disabled={tideAmountExceedsBalance(value, snapshot.playerBalance)}
              onClick={() => setAmount(value)}
            >
              <b>{compactNumber(value)} TIDE</b><span>{tier}</span>
            </button>
          ))}
      </div>
      {amountTooMuch && (
        <p className="wallet-note">You have {formatTide(snapshot.playerBalance)} in your wallet</p>
      )}
      <button className="primary wide" disabled={!hasTide || amountTooMuch}
        onClick={() => call('Launch your boat', 'stake', {
          amount: tideUnits(amount).toString(),
        })}>
        LAUNCH YOUR BOAT · {compactNumber(amount)} TIDE
      </button>
      {!hasTide && <button className="tide-needed" onClick={onOpenWallet}>
        YOU NEED TIDE TO LAUNCH A BOAT · GET TEST TIDE
      </button>}
      <small className="burn-note">1% build burn · fishes from tomorrow</small>
    </section>
  );
  if (blocked === 'FISHED') return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY · CATCH LANDED</p>
      <h2>YOUR CATCH IS IN</h2>
      <div className="landed-catch">
        <strong>+{formatTideAmount(preview)} TIDE</strong>
        <span>NET +{formatTideAmount(preview - fuel)}</span>
      </div>
      <div className="next-season">NEXT DAY IN <b>{seconds(sea?.seconds_left_in_season ?? 0)}</b></div>
      <p className="standing">STANDING · RANKING IS CATCHING UP</p>
    </section>
  );
  const fishEffort = (hard: boolean) => {
    setCustom(true);
    setEffort(hard ? 100 : fairEffort);
    void call(hard ? 'Fish hard' : 'Fish fair', 'fish', {
      effort_bps: hard ? 10000 : fairEffort * 100,
    });
  };
  return (
    <section className="your-day">
      <p className="eyebrow">YOUR DAY · THE CHOICE</p>
      <h2>HOW DO YOU FISH?</h2>
      <div className="fish-choice">
        <button className="fair-choice" onClick={() => fishEffort(false)}>
          <b>FISH FAIR</b>
          <strong>{formatTideAmount(fair)} TIDE</strong>
          <span>catch · fuel {formatTideAmount(fullFuel * fairEffort / 100)} · net
            {formatTideAmount(fair - fullFuel * fairEffort / 100)}</span>
          <small>NO INDICTMENT</small>
        </button>
        <button className="hard-choice" onClick={() => fishEffort(true)}>
          <b>FISH HARD</b>
          <strong>{formatTideAmount(fullCatch)} TIDE</strong>
          <span>full effort · fuel {formatTideAmount(fullFuel)} · net
            {formatTideAmount(fullCatch - fullFuel)}</span>
          <small>{hardOver.toFixed(1)}× YOUR SHARE · PUBLICLY INDICTED</small>
        </button>
      </div>
      <details className="custom-effort" open={custom}>
        <summary>CUSTOM EFFORT · {effort}%</summary>
        <input type="range" min="1" max="100" value={effort}
          onChange={(event) => {
            setCustom(true);
            setEffort(Number(event.target.value));
          }} />
        <div className="preview-grid">
          <span>CATCH <b>{formatTideAmount(preview)}</b></span>
          <span>FUEL <b>{formatTideAmount(fuel)}</b></span>
          <span>NET <b>{formatTideAmount(preview - fuel)}</b></span>
        </div>
        <button className="secondary wide" onClick={() => fishEffort(false)}>
          FISH CUSTOM
        </button>
      </details>
    </section>
  );
}
