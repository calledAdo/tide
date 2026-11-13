import type { Dispatch, SetStateAction } from 'react';
import { TideWallet, type WalletSnapshot } from '../near/wallet';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { tideAmountExceedsBalance } from '../config';
import { compactNumber, formatTide, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { RunAction, assemblyStage, shortName } from './shared';

type AssemblyTakeoverProps = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  run: RunAction;
  onRefresh: () => void;
};

export function AssemblyTakeover({
  wallet,
  walletApi,
  snapshot,
  onConnect,
  selected,
  setSelected,
  run,
  onRefresh,
}: AssemblyTakeoverProps) {
  const assembly = snapshot.assembly;
  const stage = assemblyStage(snapshot.sea, assembly);
  if (!assembly || !stage) return null;

  const targets = snapshot.indictments.map(([name, overage]) => ({ name, overage }));
  const shardTooMuch = tideAmountExceedsBalance(
    String(selected.length),
    snapshot.playerBalance,
  );
  const toggle = (name: string) => {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : current.length < 3
          ? [...current, name]
          : current,
    );
  };
  const walletCall = (method: string, args: Record<string, unknown>) =>
    walletApi.call(method, args);

  return (
    <div className="assembly-takeover">
      <div className="takeover-title">
        <span>ASSEMBLY IS IN SESSION</span>
        <b>{stage.toUpperCase()}</b>
      </div>
      {stage === 'hold' ? (
        <>
          <p>SHALL WE HOLD AN OSTRACISM?</p>
          {wallet.account ? (
            <div className="vote-buttons">
              <button
                className="primary"
                onClick={() =>
                  run('Vote yes', async () => {
                    const result = await walletCall('vote_hold', { yes: true });
                    onRefresh();
                    return result;
                  })
                }
              >
                YES
              </button>
              <button
                onClick={() =>
                  run('Vote no', async () => {
                    const result = await walletCall('vote_hold', { yes: false });
                    onRefresh();
                    return result;
                  })
                }
              >
                NO
              </button>
            </div>
          ) : (
            <button className="primary wide" onClick={onConnect}>
              CONNECT METAMASK TO VOTE
            </button>
          )}
          <small>
            LIVE TALLY · {assembly.hold_yes} YES / {assembly.hold_no} NO
          </small>
        </>
      ) : (
        <>
          <p>WRITE UP TO 3 SHARDS</p>
          <div className="shard-list">
            {targets.length ? (
              targets.map(({ name, overage }) => (
                <button
                  key={name}
                  className={selected.includes(name) ? 'selected' : ''}
                  onClick={() => toggle(name)}
                >
                  <b>{shortName(name)}</b>
                  <span>{compactNumber(unitsToNumber(asString(overage), TIDE_DECIMALS))} over</span>
                </button>
              ))
            ) : (
              <small>No indictments in this cycle.</small>
            )}
          </div>
          {wallet.account ? (
            <>
              <button
                className="primary wide"
                disabled={selected.length === 0 || shardTooMuch}
                onClick={() =>
                  run('Write shard', async () => {
                    const result = await walletCall('write_shard', { names: selected });
                    onRefresh();
                    return result;
                  })
                }
              >
                WRITE SHARD · BURNS {selected.length || 1} TIDE EACH
              </button>
              {shardTooMuch && (
                <p className="wallet-note">
                  You have {formatTide(snapshot.playerBalance)} in your wallet
                </p>
              )}
            </>
          ) : (
            <button className="primary wide" onClick={onConnect}>
              CONNECT METAMASK TO VOTE
            </button>
          )}
        </>
      )}
    </div>
  );
}
