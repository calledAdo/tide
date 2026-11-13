import { useState } from 'react';
import type { ReckoningView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import { tideAmountExceedsBalance, tideUnits } from '../config';
import { formatTide } from '../lib/format';
import { RunAction, seconds, shortName, useSeasonClock } from './shared';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  run: RunAction;
  onRefresh: () => void;
};

function countdown(
  target: number | null,
  season: number,
  secondsLeft: number,
  seasonLength: number,
): number | null {
  if (target === null) return null;
  return Math.max(0, (target - season - 1) * seasonLength + secondsLeft);
}

export function ReseedContributionForm({
  wallet,
  walletApi,
  snapshot,
  run,
  onRefresh,
}: Props) {
  const [amount, setAmount] = useState('1000');
  const reckoning = snapshot.reckoning;
  const amountTooMuch = tideAmountExceedsBalance(amount, snapshot.playerBalance);
  const contribute = () => run('Contribute to reseed', async () => {
    if (!wallet.account) throw new Error('Connect MetaMask first.');
    const result = await walletApi.call('contribute_reseed', {
      amount: tideUnits(amount).toString(),
    });
    onRefresh();
    return result;
  });
  return (
    <form className="reseed-form" onSubmit={(event) => {
      event.preventDefault();
      if (amount && !amountTooMuch) contribute();
    }}>
      <label>
        AMOUNT TO BURN
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
          disabled={!wallet.account || !reckoning}
        />
      </label>
      {amountTooMuch && <small>You have {formatTide(snapshot.playerBalance)}.</small>}
      <button
        className="primary"
        type="submit"
        disabled={!wallet.account || !reckoning || !amount || amountTooMuch}
      >
        {wallet.account ? 'CONTRIBUTE TO THE RESEED' : 'CONNECT TO CONTRIBUTE'}
      </button>
      <small>THIS TIDE IS BURNED FOR EVER.</small>
    </form>
  );
}

function ContributorList({ reckoning }: { reckoning: ReckoningView }) {
  if (!reckoning.contributors.length) {
    return <p className="reckoning-empty">No one has funded the next sea yet.</p>;
  }
  return (
    <div className="contributor-list">
      {reckoning.contributors.map(([account, amount]) => (
        <div key={account}>
          <span>{shortName(account)}</span>
          <b>{formatTide(asString(amount))}</b>
        </div>
      ))}
    </div>
  );
}

export function ReckoningPanel({ wallet, walletApi, snapshot, run, onRefresh }: Props) {
  const sea = snapshot.sea;
  const reckoning = snapshot.reckoning;
  const clock = useSeasonClock(sea);
  if (!reckoning || reckoning.phase !== 'Wrecked') return null;
  const latest = reckoning.history.at(-1);
  const fund = Number(asString(reckoning.reseed_fund));
  const cost = Math.max(1, Number(asString(reckoning.reseed_cost)));
  const progress = Math.min(100, fund / cost * 100);
  const deadline = countdown(
    reckoning.deadline_season,
    clock.season,
    clock.secondsLeft,
    sea?.season_len_sec ?? 60,
  );
  return (
    <section className="reckoning-panel" aria-label="The reckoning">
      <div className="reckoning-heading">
        <div>
          <p className="eyebrow">AFTER THE WRECK · GENERATION {reckoning.generation}</p>
          <h2>THE RECKONING</h2>
        </div>
        <span className="reckoning-stamp">WRECKED</span>
      </div>
      <div className="reckoning-stats">
        <div><span>BOATS WRECKED</span><b>{latest?.boats_wrecked ?? 0}</b></div>
        <div><span>TIDE BURNED</span><b>{formatTide(asString(latest?.burned_total))}</b></div>
        <div><span>THE NEXT SEA</span><b>SMALLER</b></div>
      </div>
      <p className="reckoning-copy">
        The sea will come back smaller. Every boat paid for the wreck, whether it fished fairly
        or not.
      </p>
      <div className="reseed-drive">
        <div className="reseed-drive-head">
          <div><p className="eyebrow">RESEED DRIVE</p><h3>BUY THE NEXT SEA</h3></div>
          <b>
            {formatTide(asString(reckoning.reseed_fund))} /
            {' '}{formatTide(asString(reckoning.reseed_cost))}
          </b>
        </div>
        <div className="reseed-progress" aria-label={`${Math.round(progress)}% funded`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <ReseedContributionForm wallet={wallet} walletApi={walletApi} snapshot={snapshot}
          run={run} onRefresh={onRefresh} />
        <div className="contributors">
          <p className="eyebrow">LIVE CONTRIBUTORS</p>
          <ContributorList reckoning={reckoning} />
        </div>
        <div className="reseed-deadline">
          <span>DEADLINE</span>
          <b>{deadline === null ? '—' : seconds(deadline)}</b>
          <p>
            Fund it in time and the new sea starts at 70% of capacity; miss it and it limps back
            near the point of no return.
          </p>
        </div>
      </div>
    </section>
  );
}

export function RecoveryBanner({ snapshot }: { snapshot: TideSnapshot }) {
  const sea = snapshot.sea;
  if (!sea || sea.phase !== 'Recovering') return null;
  return (
    <section className="recovery-banner">
      <b>THE SEA IS IN RECOVERY</b>
      <span> · HALF OF EVERY CATCH IS BURNED UNTIL DAY {sea.recovery_until_season ?? '—'}.</span>
    </section>
  );
}

