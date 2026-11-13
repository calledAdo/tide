import { useState } from 'react';
import type { TideSnapshot } from '../near/types';
import type { WalletSnapshot } from '../near/wallet';
import { FishSea } from './FishSea';
import { SeaHealth } from './SeaHealth';
import { CaptainCard } from './CaptainCard';
import { ProjectionPanel } from './ProjectionPanel';

type Props = {
  wallet: WalletSnapshot;
  snapshot: TideSnapshot;
};

export function PlayPage({ wallet, snapshot }: Props) {
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
        <ProjectionPanel sea={snapshot.sea} history={snapshot.history} />
      </div>
      {snapshot.error && <p className="data-error" role="alert">{snapshot.error}</p>}
      {selected && <CaptainCard account={selected} boat={selectedBoat ?? null}
        snapshot={snapshot} onClose={() => setSelected(null)} />}
    </main>
  );
}
