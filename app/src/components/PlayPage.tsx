import { useState } from 'react';
import type { TideSnapshot } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import { FishSea } from './FishSea';
import { Console } from './Console';
import { FleetTab } from './FleetTab';
import { AssemblyTab } from './AssemblyTab';
import { LogTab } from './LogTab';
import { loadTransactions, type RunAction } from './shared';

type PlayPageProps = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function PlayPage({
  wallet,
  walletApi,
  snapshot,
  onConnect,
  run,
  onRefresh,
}: PlayPageProps) {
  const [tab, setTab] = useState<'fleet' | 'assembly' | 'log'>('fleet');
  const [intro, setIntro] = useState(true);

  return (
    <main className="play-page">
      {intro && !wallet.account && (
        <div className="intro-strip">
          A MEMECOIN THAT IS A FISHERY. FISH IT, DON&apos;T EMPTY IT, VOTE OUT THE GREEDY.
          <a href="#/replay">WATCH THE 60-SECOND REPLAY →</a>
          <button aria-label="Dismiss intro" onClick={() => setIntro(false)}>×</button>
        </div>
      )}
      <div className="play-grid">
        <FishSea sea={snapshot.sea} snapshot={snapshot} account={wallet.account} />
        <Console
          wallet={wallet}
          walletApi={walletApi}
          snapshot={snapshot}
          onConnect={onConnect}
          run={run}
          onRefresh={onRefresh}
        />
      </div>
      <section className="tabs-section">
        <div className="tab-strip">
          {(['fleet', 'assembly', 'log'] as const).map((item) => (
            <button
              key={item}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item === 'fleet' ? 'FLEET' : item === 'assembly' ? 'ASSEMBLY' : 'LOG'}
            </button>
          ))}
        </div>
        {tab === 'fleet' && <FleetTab snapshot={snapshot} account={wallet.account} />}
        {tab === 'assembly' && <AssemblyTab assembly={snapshot.assembly} sea={snapshot.sea} />}
        {tab === 'log' && <LogTab records={loadTransactions()} />}
      </section>
    </main>
  );
}
