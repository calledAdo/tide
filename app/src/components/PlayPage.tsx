import { useState } from 'react';
import type { TideSnapshot } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import { FishSea } from './FishSea';
import { YourDay } from './YourDay';
import { SeaHealth } from './SeaHealth';
import { CaptainCard } from './CaptainCard';
import { RunAction } from './shared';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  onConnect: () => void;
  onOpenWallet: () => void;
  run: RunAction;
  onRefresh: () => void;
};

export function PlayPage({ wallet, walletApi, snapshot, onConnect, onOpenWallet, run, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedBoat = selected ? snapshot.boats[selected] : null;
  return (
    <main className="play-page">
      <div className="play-grid">
        <div>
          <FishSea sea={snapshot.sea} snapshot={snapshot} account={wallet.account}
            onSelect={setSelected} />
          <SeaHealth sea={snapshot.sea} history={snapshot.history} />
        </div>
        <YourDay wallet={wallet} walletApi={walletApi} snapshot={snapshot}
          onConnect={onConnect} onOpenWallet={onOpenWallet} run={run}
          onRefresh={onRefresh} />
      </div>
      {snapshot.error && <p className="data-error" role="alert">{snapshot.error}</p>}
      {selected && <CaptainCard account={selected} boat={selectedBoat ?? null}
        snapshot={snapshot} onClose={() => setSelected(null)} />}
    </main>
  );
}
