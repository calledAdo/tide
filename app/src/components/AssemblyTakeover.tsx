import { useState } from 'react';
import { TideWallet, type WalletSnapshot } from '../near/wallet';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { tideAmountExceedsBalance } from '../config';
import { formatTide } from '../lib/format';
import { RunAction, assemblyStage, shortName } from './shared';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  selected: string[];
  setSelected: (names: string[]) => void;
  run: RunAction;
  onRefresh: () => void;
};

export function AssemblyTakeover({
  wallet, walletApi, snapshot, onConnect, selected, setSelected, run, onRefresh,
}: Props) {
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null);
  const stage = assemblyStage(snapshot.sea, snapshot.assembly);
  const assembly = snapshot.assembly;
  if (!stage || !assembly) return null;
  const eligible = assembly.eligible;
  const needed = Math.floor(eligible / 2) + 1;
  const empty = snapshot.indictments.length === 0;
  const call = (label: string, method: string, args: Record<string, unknown>) => run(
    label,
    async () => {
      const result = await walletApi.call(method, args);
      onRefresh();
      return result;
    },
  );
  const vote = (yes: boolean) => {
    setChoice(yes ? 'yes' : 'no');
    call(yes ? 'Vote yes, hold one' : 'Vote no, not today', 'vote_hold', { yes });
  };
  const toggle = (name: string) => setSelected(
    selected.includes(name)
      ? selected.filter((item) => item !== name)
      : selected.length < 3 ? [...selected, name] : selected,
  );
  const shardTooMuch = tideAmountExceedsBalance(String(selected.length), snapshot.playerBalance);
  if (stage === 'hold') return (
    <section className="agora-stage-copy">
      <p className="eyebrow">STAGE 1 · THE HOLD VOTE</p>
      <h2>SHOULD ANYONE BE BANISHED TODAY?</h2>
      <p>
        Every captain may fish a fair share. Captains who took more are listed below. If more than
        half of all captains agree, the assembly moves to naming.
      </p>
      <div className="threshold-bar">
        <i style={{ width: `${Math.min(100, (assembly.hold_yes / Math.max(1, needed)) * 100)}%` }} />
        <b>{assembly.hold_yes} of {needed} needed · {eligible} captains eligible</b>
      </div>
      {empty && <p className="empty-docket">
        Nobody overfished this cycle. There is nothing to decide. The vote defaults to NO.
      </p>}
      {wallet.account ? (
        <div className="vote-buttons">
          <button className="primary" disabled={empty || choice !== null} onClick={() => vote(true)}>
            YES, HOLD ONE
          </button>
          <button disabled={choice !== null} onClick={() => vote(false)}>NO, NOT TODAY</button>
        </div>
      ) : (
        <button className="primary wide" onClick={onConnect}>CONNECT METAMASK TO VOTE</button>
      )}
      {choice && <p className="your-choice">
        YOUR CHOICE: {choice === 'yes' ? 'YES, HOLD ONE' : 'NO, NOT TODAY'}
      </p>}
      <small className="live-tally">LIVE TALLY · {assembly.hold_yes} YES / {assembly.hold_no} NO</small>
    </section>
  );
  if (!assembly.last_result?.held && assembly.last_result?.cycle === assembly.cycle) return (
    <section className="agora-stage-copy">
      <p className="eyebrow">STAGE 2 · WRITING SHARDS</p>
      <h2>NAME WHO TO BANISH</h2>
      <p className="assembly-failed">
        The assembly chose not to hold one today. Nobody can be named. Tally: {assembly.hold_yes} YES /
        {' '}{assembly.hold_no} NO.
      </p>
    </section>
  );
  return (
    <section className="agora-stage-copy">
      <p className="eyebrow">STAGE 2 · WRITING SHARDS</p>
      <h2>NAME WHO TO BANISH</h2>
      <p>
        In Athens, citizens scratched a name on a piece of broken pottery, an <i>ostrakon</i>. Write
        up to 3 names. Each name costs 1 TIDE, burned. A captain named by at least {assembly.quorum_shards}
        {' '}of the {eligible} captains is banished for 10 days: no fishing, no transfers, no voting. They
        keep every token they own.
      </p>
      <div className="shard-quorum">LIVE QUORUM · {assembly.quorum_shards} OF {eligible} CAPTAINS</div>
      <div className="shard-list">
        {snapshot.indictments.length ? snapshot.indictments.map(([name, overage]) => {
          const fair = Number(asString(snapshot.boats[name]?.fair_share));
          const extra = Number(asString(overage));
          const ratio = fair > 0 ? 1 + extra / fair : 0;
          const count = assembly.shards.find(([item]) => item === name)?.[1] ?? 0;
          return (
            <button
              key={name}
              className={selected.includes(name) ? 'selected' : ''}
              onClick={() => toggle(name)}
            >
              <b>{shortName(name)}</b>
              <span>+{formatTide(asString(overage))} over · {ratio.toFixed(1)}× its share</span>
              <small>{count} / {assembly.quorum_shards} names · NAME THIS CAPTAIN</small>
            </button>
          );
        }) : (
          <button disabled><b>NO ACCUSED CAPTAINS</b><span>not accused this cycle</span></button>
        )}
      </div>
      <div className="ballot">
        <b>YOUR SHARD: {selected.length ? selected.map(shortName).join(', ') : '—'}</b>
        <span>{selected.length || 1} TIDE will be burned</span>
      </div>
      {wallet.account ? (
        <>
          <button className="primary wide" disabled={!selected.length || shardTooMuch}
            onClick={() => call('Cast your shard', 'write_shard', { names: selected })}>
            CAST YOUR SHARD
          </button>
          {shardTooMuch && (
            <p className="wallet-note">You have {formatTide(snapshot.playerBalance)} in your wallet</p>
          )}
        </>
      ) : (
        <button className="primary wide" onClick={onConnect}>CONNECT METAMASK TO VOTE</button>
      )}
      <small className="live-tally">A NAME NEEDS {assembly.quorum_shards} VOTES TO BANISH</small>
    </section>
  );
}
