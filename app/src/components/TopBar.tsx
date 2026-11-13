import { isEthImplicitAccount, formatAccountAddress, type WalletSnapshot } from '../near/wallet';
import type { SeaView, TideSnapshot } from '../near/types';
import { compactNumber, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { assemblyStage, seconds } from './shared';

type TopBarProps = {
  sea: SeaView | null;
  snapshot: TideSnapshot;
  wallet: WalletSnapshot;
  onConnect: () => void;
  onOpenPanel: () => void;
};

export function TopBar({
  sea,
  snapshot,
  wallet,
  onConnect,
  onOpenPanel,
}: TopBarProps) {
  const href = location.hash || '#/';
  const stage = assemblyStage(sea, snapshot.assembly);

  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <b>TD</b>
        <span>$TIDE</span>
        <i>| NEAR</i>
      </a>
      <nav aria-label="Primary">
        <a className={href === '#/' || href === '' ? 'active' : ''} href="#/">
          PLAY
        </a>
        <a className={href === '#/replay' ? 'active' : ''} href="#/replay">
          REPLAY
        </a>
        <a className={href === '#/how' ? 'active' : ''} href="#/how">
          HOW IT WORKS
        </a>
      </nav>
      <div className="topbar-actions">
        {sea && (
          <div className={`season-chip ${stage ? 'assembly' : ''}`}>
            <b>{stage ? 'ASSEMBLY' : `SEASON ${sea.season}`}</b>
            <span>{stage ? stage.toUpperCase() : seconds(sea.seconds_left_in_season)}</span>
          </div>
        )}
        {wallet.account ? (
          <button className="wallet-chip" onClick={onOpenPanel} aria-label="Open wallet panel">
            <b>{formatAccountAddress(wallet.account)}</b>
            <span>
              {wallet.dev
                ? 'DEV SIGNER'
                : `${compactNumber(unitsToNumber(snapshot.playerBalance, TIDE_DECIMALS))} TIDE`}
            </span>
          </button>
        ) : (
          <button className="primary connect-chip" onClick={onConnect}>
            CONNECT METAMASK
          </button>
        )}
      </div>
    </header>
  );
}
