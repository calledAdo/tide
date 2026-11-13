import { useEffect, useState } from 'react';
import { tideAmountExceedsBalance, tideUnits } from '../config';
import { TideWallet, type WalletSnapshot } from '../near/wallet';
import { callWithStorageRegistration, claimFaucet, type StorageClient } from '../near/registration';
import { historyApi } from '../near/history';
import type { BoatView, SeaView, TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import {
  compactNumber,
  formatTide,
  formatTideAmount,
  unitsToNumber,
  TIDE_DECIMALS,
} from '../lib/format';
import {
  assemblyStage,
  isFaucetClaimedLocally,
  markFaucetClaimed,
  RunAction,
  seconds,
} from './shared';
import { AssemblyTakeover } from './AssemblyTakeover';

type ConsoleCall = (
  label: string,
  method: string,
  args?: Record<string, unknown>,
  deposit?: bigint,
  done?: () => void,
) => void;

type ConsoleProps = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  tideClient: StorageClient;
  snapshot: TideSnapshot;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function Console({
  wallet,
  walletApi,
  tideClient,
  snapshot,
  onConnect,
  run,
  onRefresh,
}: ConsoleProps) {
  const account = wallet.account;
  const boat = account ? snapshot.boats[account] : null;
  const sea = snapshot.sea;
  const [buildAmount, setBuildAmount] = useState('100000');
  const [effort, setEffort] = useState(50);
  const [claimed, setClaimed] = useState(false);
  const [indexerClaimed, setIndexerClaimed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [actionProgress, setActionProgress] = useState('');
  const stage = assemblyStage(sea, snapshot.assembly);
  const hasBoat = Boolean(boat && Number(asString(boat.boat.stake)) > 0);
  const hasTide = BigInt(snapshot.playerBalance || '0') > 0n;
  const hasNear = BigInt(snapshot.nearBalance || '0') > 0n;
  const isRegistered = snapshot.playerStorage !== null;
  const setupRequired = Boolean(account && (!hasNear || !isRegistered));
  const faucetClaimed = claimed || hasTide || hasBoat || indexerClaimed;

  useEffect(() => {
    if (!account) {
      setClaimed(false);
      setIndexerClaimed(false);
      return undefined;
    }
    setClaimed(isFaucetClaimedLocally(account));
    setIndexerClaimed(false);
    let live = true;
    const onClaimed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === account) setClaimed(true);
    };
    window.addEventListener('tide-faucet-claimed', onClaimed);
    void historyApi.faucetClaimed(account).then((value) => {
      if (live) setIndexerClaimed(value);
    }).catch(() => undefined);
    return () => {
      live = false;
      window.removeEventListener('tide-faucet-claimed', onClaimed);
    };
  }, [account]);

  const exiledUntil = boat?.exiled_until ?? null;
  const fair = boat
    ? unitsToNumber(asString(boat.fair_share), TIDE_DECIMALS)
    : 0;
  const fullEffortCatch = boat
    ? unitsToNumber(asString(boat.full_effort_catch), TIDE_DECIMALS)
    : 0;
  const preview = boat
    ? (fullEffortCatch * effort) / 100
    : 0;
  const over = fair > 0 ? preview / fair : 0;
  const call = (
    label: string,
    method: string,
    args: Record<string, unknown> = {},
    deposit = 0n,
    done?: () => void,
  ) =>
    run(label, async () => {
      const result = await walletApi.call(method, args, deposit);
      done?.();
      onRefresh();
      return result;
    });
  const registeredCall = (
    label: string,
    method: string,
    args: Record<string, unknown> = {},
    _deposit = 0n,
    done?: () => void,
  ) => run(label, async () => {
    if (!account) throw new Error('Connect MetaMask first.');
    const result = method === 'claim_faucet'
      ? await claimFaucet(walletApi, tideClient, account, setActionProgress)
      : await callWithStorageRegistration(
        walletApi,
        tideClient,
        account,
        { method, args, progress: 'Staking…' },
        setActionProgress,
      );
    done?.();
    onRefresh();
    return result;
  });

  return (
    <section className="console">
      <div className="console-head">
        <p className="eyebrow">YOUR BOAT · COMMAND DECK</p>
        <span className={wallet.dev ? 'dev-badge' : 'online-dot'}>
          {wallet.dev ? 'DEV SIGNER' : 'READY'}
        </span>
      </div>
      {stage && snapshot.assembly && (
        <AssemblyTakeover
          wallet={wallet}
          walletApi={walletApi}
          snapshot={snapshot}
          onConnect={onConnect}
          selected={selected}
          setSelected={setSelected}
          run={run}
          onRefresh={onRefresh}
        />
      )}
      <div className="console-state">
        {!account && <ConnectStep wallet={wallet} onConnect={onConnect} />}
        {account && wallet.progress && <SetupStep progress={wallet.progress} />}
        {account && !wallet.progress && setupRequired && <SetupStep />}
        {account && !wallet.progress && !setupRequired && sea && sea.seasons_behind > 40 && (
          <SettlementStep call={call} />
        )}
        {account &&
          !wallet.progress &&
          !setupRequired &&
          (!sea || sea.seasons_behind <= 40) &&
          !faucetClaimed && <ClaimStep wallet={wallet} call={registeredCall}
            setClaimed={setClaimed} progress={actionProgress} />}
        {account &&
          !wallet.progress &&
          !setupRequired &&
          (!sea || sea.seasons_behind <= 40) &&
          !hasBoat &&
          faucetClaimed && (
            <BuildStep
              buildAmount={buildAmount}
              setBuildAmount={setBuildAmount}
              call={registeredCall}
              balance={snapshot.playerBalance}
              progress={actionProgress}
            />
          )}
        {account &&
          !wallet.progress &&
          !setupRequired &&
          (!sea || sea.seasons_behind <= 40) &&
          hasBoat &&
          !stage && (
            <FishingStep
              boat={boat!}
              sea={sea}
              effort={effort}
              setEffort={setEffort}
              preview={preview}
              fair={fair}
              fullEffortCatch={fullEffortCatch}
              over={over}
              exiledUntil={exiledUntil}
              walletApi={walletApi}
              run={run}
              onRefresh={onRefresh}
            />
          )}
      </div>
      <details className="boat-details">
        <summary>BOAT · TOP UP / UNSTAKE</summary>
        <div>
          <p>Stake is held in the contract. An indicted or exiled boat cannot unstake.</p>
          <button
            className="link-button"
            onClick={() => alert('Top up uses the BUILD BOAT action above.')}
          >
            TOP UP
          </button>
          <button className="link-button">UNSTAKE</button>
        </div>
      </details>
    </section>
  );
}

function ConnectStep({ wallet, onConnect }: { wallet: WalletSnapshot; onConnect: () => void }) {
  return (
    <>
      <p className="step-kicker">01 / FIRST STEP</p>
      <h2>CONNECT<br />METAMASK</h2>
      <p className="console-copy">Your boat begins as a NEAR eth-implicit account.</p>
      <button className="primary wide" onClick={onConnect}>CONNECT METAMASK</button>
      {wallet.error && (
        <p className="wallet-error" role="alert">
          {wallet.error}
          {/MetaMask not detected/i.test(wallet.error) && (
            <>
              {' '}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                INSTALL METAMASK ↗
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}

function SetupStep({ progress }: { progress?: string }) {
  return (
    <>
      <p className="step-kicker">SETTING UP</p>
      <h2>{progress ? progress.toUpperCase() : 'YOUR ACCOUNT'}</h2>
      <div className="progress-pulse" role="status" />
    </>
  );
}

function SettlementStep({ call }: { call: ConsoleCall }) {
  return (
    <>
      <p className="step-kicker">SETTLEMENT REQUIRED</p>
      <h2>SETTLE<br />THE SEA</h2>
      <p className="console-copy">
        The chain is more than 40 seasons behind. Settle before taking another action.
      </p>
      <button className="primary wide" onClick={() => call('Settle the sea', 'tick')}>
        TICK · SETTLE THE SEA
      </button>
    </>
  );
}

function ClaimStep({
  wallet,
  call,
  setClaimed,
  progress,
}: {
  wallet: WalletSnapshot;
  call: ConsoleCall;
  setClaimed: (value: boolean) => void;
  progress: string;
}) {
  return (
    <>
      <p className="step-kicker">02 / CLAIM YOUR CAPITAL</p>
      <h2>CLAIM<br />100,000 TIDE</h2>
      <p className="console-copy">
        One faucet claim per account. You need a registered token account.
      </p>
      <button
        className="primary wide"
        disabled={wallet.dev}
        onClick={() =>
          call('Claim faucet', 'claim_faucet', {}, 0n, () => {
            if (wallet.account) markFaucetClaimed(wallet.account);
            setClaimed(true);
          })
        }
      >
        {wallet.dev ? 'NOT AVAILABLE WITH DEV SIGNER' : progress || 'CLAIM FAUCET'}
      </button>
    </>
  );
}

function BuildStep({
  buildAmount,
  setBuildAmount,
  call,
  balance,
  progress,
}: {
  buildAmount: string;
  setBuildAmount: (value: string) => void;
  call: ConsoleCall;
  balance: string;
  progress: string;
}) {
  const amountTooMuch = tideAmountExceedsBalance(buildAmount, balance);
  return (
    <>
      <p className="step-kicker">03 / BUILD THE HULL</p>
      <h2>BUILD<br />YOUR BOAT</h2>
      <label className="console-label">
        STAKE AMOUNT
        <input
          value={buildAmount}
          inputMode="numeric"
          onChange={(event) => setBuildAmount(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <div className="preset-row">
        {['10000', '50000', '100000'].map((preset) => (
          <button
            key={preset}
            aria-pressed={buildAmount === preset}
            disabled={tideAmountExceedsBalance(preset, balance)}
            onClick={() => setBuildAmount(preset)}
          >
            {compactNumber(preset)}
          </button>
        ))}
      </div>
      {amountTooMuch && (
        <p className="wallet-note">You have {formatTide(balance)} in your wallet</p>
      )}
      <p className="burn-note">1% burned · fishes from next season</p>
      <button
        className="primary wide"
        disabled={!buildAmount || amountTooMuch}
        onClick={() => call('Build your boat', 'stake', {
          amount: tideUnits(buildAmount).toString(),
        })}
      >
        {progress || 'BUILD BOAT'}
      </button>
    </>
  );
}

type FishingStepProps = {
  boat: BoatView;
  sea: SeaView | null;
  effort: number;
  setEffort: (value: number) => void;
  preview: number;
  fair: number;
  fullEffortCatch: number;
  over: number;
  exiledUntil: number | null;
  walletApi: TideWallet;
  run: RunAction;
  onRefresh: () => void;
};

function FishingStep({
  boat,
  sea,
  effort,
  setEffort,
  preview,
  fair,
  fullEffortCatch,
  over,
  exiledUntil,
  walletApi,
  run,
  onRefresh,
}: FishingStepProps) {
  const reason = sea?.dead
    ? 'THE SEA IS DEAD'
    : sea && sea.seasons_behind > 40
      ? 'SETTLE THE SEA FIRST'
      : exiledUntil
        ? `EXILED UNTIL DAY ${exiledUntil}`
            : boat.boat.last_fished === sea?.season
          ? 'FISHED TODAY'
          : boat.boat.stake_season === sea?.season
            ? 'RIGGING'
            : '';
  const canFish = boat.can_fish_now && !reason;
  const fuel = (unitsToNumber(asString(boat.full_effort_fuel), TIDE_DECIMALS) * effort) / 100;

  return (
    <>
      <p className="step-kicker">04 / THE NEXT MOVE</p>
      {canFish ? (
        <>
          <h2>FISH<br />THE SEA</h2>
          <label className="effort-label">
            EFFORT <b>{effort}%</b>
            <input
              type="range"
              min="1"
              max="100"
              value={effort}
              onChange={(event) => setEffort(Number(event.target.value))}
            />
          </label>
          <div className="preview-grid">
            <span>CATCH <b>{formatTideAmount(preview)}</b></span>
            <span>FUEL <b>{formatTideAmount(fuel)}</b></span>
            <span>NET <b>{formatTideAmount(preview - fuel)}</b></span>
          </div>
          {over > 1.001 && (
            <p className="amber-note">{over.toFixed(1)}× YOUR FAIR SHARE · INDICTMENT RISK</p>
          )}
          <div className="console-actions">
            <button
              className="link-button"
              onClick={() =>
                setEffort(Math.max(
                  1,
                  Math.round(
                    (fair / Math.max(1, fullEffortCatch)) *
                      100,
                  ),
                ))
              }
            >
              SET TO FAIR SHARE
            </button>
            <button
              className="primary wide"
              onClick={() =>
                run('Fish', async () => {
                  const result = await walletApi.call('fish', {
                    effort_bps: Math.round(effort * 100),
                  });
                  onRefresh();
                  return result;
                })
              }
            >
              FISH
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>{reason || 'NEXT SEASON'}</h2>
          <p className="console-copy">
            {reason === 'FISHED TODAY'
              ? 'Your catch is in the water. Come back next season.'
              : 'The boat is waiting for its first season.'}
          </p>
          <div className="next-season">
            NEXT SEASON IN <b>{seconds(sea?.seconds_left_in_season ?? 0)}</b>
          </div>
        </>
      )}
    </>
  );
}
