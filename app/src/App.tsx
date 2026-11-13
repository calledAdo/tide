import { useEffect, useState } from 'react';
import { CONTRACT, EXPLORER } from './config';
import { TideClient } from './near/tide';
import {
  TideWallet,
  type TransactionResult,
  type WalletSnapshot,
} from './near/wallet';
import type { TideSnapshot } from './near/types';
import { HowPage } from './components/HowPage';
import { PlayPage } from './components/PlayPage';
import { ReplayPage } from './components/ReplayPage';
import { TopBar } from './components/TopBar';
import { Toasts } from './components/Toasts';
import { WalletPanel } from './components/WalletPanel';
import { loadTransactions, type RunAction, type Toast } from './components/shared';
import './styles.css';

type Route = 'play' | 'replay' | 'how';

function useRoute(): Route {
  const route = (): Route => {
    if (location.hash === '#/replay') return 'replay';
    if (location.hash === '#/how') return 'how';
    return 'play';
  };
  const [value, setValue] = useState<Route>(route);

  useEffect(() => {
    const update = () => setValue(route());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return value;
}

function explorerTx(hash: string): string {
  return `${EXPLORER}/txns/${hash}`;
}

function saveTransaction(result: TransactionResult, label: string): void {
  const list = [
    {
      hash: result.hash,
      url: result.url || explorerTx(result.hash),
      label,
      time: Date.now(),
    },
    ...loadTransactions(),
  ].slice(0, 10);
  localStorage.setItem(`tide-transactions:${CONTRACT}`, JSON.stringify(list));
}

export default function App() {
  const route = useRoute();
  const [wallet] = useState(() => new TideWallet());
  const [client] = useState(() => new TideClient());
  const [walletState, setWalletState] = useState<WalletSnapshot>(wallet.state);
  const [snapshot, setSnapshot] = useState<TideSnapshot>(client.state);
  const [panel, setPanel] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => wallet.subscribe(setWalletState), [wallet]);
  useEffect(() => client.subscribe(setSnapshot), [client]);
  useEffect(() => client.start(), [client]);
  useEffect(() => {
    client.setAccount(walletState.account);
  }, [client, walletState.account]);
  useEffect(() => {
    void wallet.initializeWallet().catch((error: unknown) => {
      console.error('Wallet initialization failed', error);
    });
  }, [wallet]);
  useEffect(() => {
    setPanel(false);
  }, [route]);

  const run: RunAction = (label, task) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [
      ...items,
      { id, kind: 'pending', text: `Confirm ${label} in MetaMask…` },
    ]);
    void task()
      .then((result) => {
        if (result.hash) saveTransaction(result, label);
        setToasts((items) => items.map((item) => item.id === id
          ? {
            ...item,
            kind: 'success',
            text: `${label} complete`,
            ...(result.hash ? { result } : {}),
          }
          : item));
      })
      .catch((error: unknown) => {
        setToasts((items) => items.map((item) => item.id === id
          ? {
            ...item,
            kind: 'error',
            text: error instanceof Error ? error.message : 'Transaction failed.',
          }
          : item));
      });
  };

  const connect = () => void wallet.connect().catch(() => undefined);
  const refresh = () => void client.refresh();
  const disconnect = () => {
    void wallet.disconnect();
    setPanel(false);
  };

  return (
    <>
      <TopBar
        sea={snapshot.sea}
        snapshot={snapshot}
        wallet={walletState}
        onConnect={connect}
        onOpenPanel={() => setPanel(true)}
      />
      {route === 'play' && (
        <PlayPage
          wallet={walletState}
          walletApi={wallet}
          snapshot={snapshot}
          onConnect={connect}
          run={run}
          onRefresh={refresh}
        />
      )}
      {route === 'replay' && <ReplayPage />}
      {route === 'how' && <HowPage params={snapshot.params} />}
      {panel && (
        <WalletPanel
          wallet={wallet}
          tideClient={client}
          snapshot={snapshot}
          onClose={() => setPanel(false)}
          onDisconnect={disconnect}
          run={run}
        />
      )}
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))}
      />
    </>
  );
}
