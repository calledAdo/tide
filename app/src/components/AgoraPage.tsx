import { useEffect, useState } from 'react';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { historyApi, type AssemblyHistory } from '../near/history';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import { compactNumber, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { assemblyStage, shortName, RunAction } from './shared';
import { AssemblyTakeover } from './AssemblyTakeover';

type Props = {
  snapshot: TideSnapshot;
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function AgoraPage({ snapshot, wallet, walletApi, onConnect, run, onRefresh }: Props) {
  const [assemblies, setAssemblies] = useState<AssemblyHistory[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [loadingAssemblies, setLoadingAssemblies] = useState(true);
  const [showAllCycles, setShowAllCycles] = useState(false);
  const stage = assemblyStage(snapshot.sea, snapshot.assembly);
  useEffect(() => {
    let live = true;
    setLoadingAssemblies(true);
    setFailed(false);
    void historyApi.assemblies(50, !showAllCycles).then((data) => {
      if (live) {
        setAssemblies(data);
        setLoadingAssemblies(false);
      }
    }).catch(() => {
      if (live) {
        setFailed(true);
        setLoadingAssemblies(false);
      }
    });
    return () => { live = false; };
  }, [showAllCycles, snapshot.sea?.season]);
  return (
    <main className={`route-page agora-page ${stage ? 'agora-live' : ''}`}>
      <div className="route-heading">
        <div>
          <p className="eyebrow">PUBLIC SQUARE · CYCLES OF ACCOUNTABILITY</p>
          <h1>THE AGORA</h1>
        </div>
        <span>{stage ? `${stage.toUpperCase()} IN SESSION` : 'DOCKET OPEN'}</span>
      </div>
      {stage && snapshot.assembly ? (
        <section className="assembly-stage">
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
        </section>
      ) : (
        <section className="docket">
          <p className="eyebrow">
            CURRENT DOCKET · CYCLE {snapshot.assembly?.cycle ?? '—'}
          </p>
          <h2>ACCUSED OF OVERFISHING</h2>
          <div className="docket-grid">
            {snapshot.indictments.map(([name, overage]) => (
              <article key={name}>
                <b>{shortName(name)}</b>
                <span>
                  {compactNumber(unitsToNumber(asString(overage), TIDE_DECIMALS))}
                  {' '}OVER FAIR SHARE
                </span>
                <small>INDICTED THIS CYCLE</small>
              </article>
            ))}
            {!snapshot.indictments.length && <p>The docket is clear. Fish fair, captain.</p>}
          </div>
          <p className="connect-note">
            {wallet.account
              ? 'The next assembly will open here.'
              : 'Connect to vote when the assembly opens.'}
          </p>
        </section>
      )}
      <section className="ostraka">
        <div className="archive-heading">
          <div>
            <p className="eyebrow">ARCHIVE · /API/ASSEMBLIES</p>
            <h2>THE OSTRAKA WALL</h2>
          </div>
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={showAllCycles}
              onChange={(event) => setShowAllCycles(event.target.checked)}
            />
            SHOW ALL CYCLES
          </label>
        </div>
        {failed && (
          <p className="history-note">
            History is catching up. Current on-chain assembly remains available.
          </p>
        )}
        {!failed && loadingAssemblies && (
          <p className="history-note">Loading past cycles…</p>
        )}
        {!failed && !loadingAssemblies && !assemblies.length && (
          <div className="archive-empty">
            <b>NO RECORDED ACTIONS</b>
            <span>Votes, shards, and exiles will appear here.</span>
          </div>
        )}
        <div className="stone-grid">
          {assemblies.map((item) => (
            <article className="stone" key={item.cycle}>
              <span>CYCLE {item.cycle}</span>
              <h3>{item.held ? 'OSTRACISM HELD' : 'NO HOLD'}</h3>
              <b>{item.holdYes} YES · {item.holdNo} NO / {item.eligible} ELIGIBLE</b>
              <p>
                {Object.entries(item.shards ?? {})
                  .map(([name, count]) => `${shortName(name)} ×${count}`)
                  .join(' · ') || 'No shards written'}
              </p>
              {item.exiled.length > 0 && (
                <small>EXILED: {item.exiled.map(shortName).join(', ')}</small>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
