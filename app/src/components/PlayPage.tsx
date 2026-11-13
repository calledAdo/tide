import { useState } from 'react';
import type { TideSnapshot } from '../near/types';
import type { TideWallet, WalletSnapshot } from '../near/wallet';
import type { RunAction } from './shared';
import { FishSea } from './FishSea';
import { SeaHealth } from './SeaHealth';
import { CaptainCard } from './CaptainCard';
import { ProjectionPanel } from './ProjectionPanel';
import { ReckoningPanel, RecoveryBanner } from './ReckoningPanel';

type Props = {
  wallet: WalletSnapshot;
  walletApi: TideWallet;
  snapshot: TideSnapshot;
  run: RunAction;
  onRefresh: () => void;
};

export function PlayPage({ wallet, walletApi, snapshot, run, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedBoat = selected ? snapshot.boats[selected] : null;
  return (
    <main className="play-page">
      <div className="play-grid">
        <div>
          <FishSea sea={snapshot.sea} snapshot={snapshot} account={wallet.account}
            onSelect={setSelected} />
          <RecoveryBanner snapshot={snapshot} />
          <ReckoningPanel wallet={wallet} walletApi={walletApi} snapshot={snapshot}
            run={run} onRefresh={onRefresh} />
          <SeaHealth sea={snapshot.sea} history={snapshot.history} />
        </div>
        <ProjectionPanel sea={snapshot.sea} history={snapshot.history} />
      </div>
      {snapshot.error && <p className="data-error" role="alert">{snapshot.error}</p>}
      {selected && <CaptainCard account={selected} boat={selectedBoat ?? null}
        snapshot={snapshot} onClose={() => setSelected(null)} />}
    </main>
  );
}
