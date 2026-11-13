import { formatAccountAddress, type WalletSnapshot } from '../near/wallet';
import type { TideSnapshot } from '../near/types';
import { compactNumber, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { assemblyStage } from './shared';

type Props = {
  snapshot: TideSnapshot;
  wallet: WalletSnapshot;
  onConnect: () => void;
  onOpenPanel: () => void;
};

export function TopBar({ snapshot, wallet, onConnect, onOpenPanel }: Props) {
  const href = location.hash || '#/';
  const nav = [['#/', 'SEA'], ['#/harbour', 'HARBOUR'], ['#/agora', 'AGORA'], ['#/boat', 'YOUR BOAT']];
  const boat = wallet.account ? snapshot.boats[wallet.account] : null;
  const needsBoat = Boolean(
    wallet.account && (boat?.can_fish_now || assemblyStage(snapshot.sea, snapshot.assembly)),
  );
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <b>TD</b><span>$TIDE</span><i>| NEAR</i>
      </a>
      <nav aria-label="Primary">
        {nav.map(([url, label]) => (
          <a className={href === url ? 'active' : ''} href={url} key={url}>
            <span className="nav-icon">
              {label === 'SEA' ? '◒' : label === 'HARBOUR' ? '▤' : label === 'AGORA' ? '⚖' : '◈'}
            </span>
            <span>
              {label}
              {label === 'YOUR BOAT' && needsBoat && (
                <i className="nav-dot" aria-label="Action available" />
              )}
            </span>
          </a>
        ))}
      </nav>
      <div className="more-nav">
        <a href="#/replay" className={href === '#/replay' ? 'active' : ''}>REPLAY</a>
        <a href="#/how" className={href === '#/how' ? 'active' : ''}>HOW</a>
      </div>
      <div className="topbar-actions">
        {wallet.account ? (
          <button className="wallet-chip" onClick={onOpenPanel} aria-label="Open wallet panel">
            <b>{formatAccountAddress(wallet.account)}</b>
            <span>
              {wallet.dev ? 'DEV SIGNER' : `${compactNumber(
                unitsToNumber(snapshot.playerBalance, TIDE_DECIMALS),
              )} TIDE`}
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
