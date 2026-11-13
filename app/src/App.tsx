import { useCallback, useEffect, useState } from 'react';
import { CONTRACT, EXPLORER } from './config';
import { TideClient } from './near/tide';
import { TideWallet, type TransactionResult, type WalletSnapshot } from './near/wallet';
import type { TideSnapshot } from './near/types';
import { HowPage } from './components/HowPage';
import { PlayPage } from './routes/SeaRoute';
import { HarbourPage } from './routes/HarbourRoute';
import { AgoraPage } from './routes/AgoraRoute';
import { BoatPage } from './routes/BoatRoute';
import { ReplayPage } from './components/ReplayPage';
import { TopBar } from './components/TopBar';
import { SeasonTimeline } from './components/SeasonTimeline';
import { AssemblyBar } from './components/AssemblyBar';
import { Toasts } from './components/Toasts';
import { WalletPanel } from './components/WalletPanel';
import {
  loadTransactions,
  markFaucetClaimed,
  type RunAction,
  type Toast,
} from './components/shared';
import './styles.css';

type Route = 'sea' | 'harbour' | 'agora' | 'boat' | 'replay' | 'how';

function useRoute(): Route {
  const read = (): Route => {
    const value = location.hash.replace('#/', '');
    if (value === 'harbour' || value === 'agora' || value === 'boat'
      || value === 'replay' || value === 'how') return value;
    return 'sea';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const update = () => setRoute(read());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

function explorerTx(hash: string): string { return `${EXPLORER}/txns/${hash}`; }

function saveTransaction(result: TransactionResult, label: string): void {
  const list = [
    { hash: result.hash, url: result.url || explorerTx(result.hash), label, time: Date.now() },
    ...loadTransactions(),
  ].slice(0, 10);
  localStorage.setItem(`tide-transactions:${CONTRACT}`, JSON.stringify(list));
}

const ALREADY_CLAIMED_TOAST =
  'You already claimed your test TIDE; it is in your wallet or your boat.';

function toastErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Transaction failed.';
  if (/already claimed/i.test(message)) {
    return ALREADY_CLAIMED_TOAST;
  }
  if (/doesn['’]t have enough balance/i.test(message)) {
    return 'Not enough TIDE in your wallet for this.';
  }
  return message;
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
  useEffect(() => { client.setAccount(walletState.account); }, [client, walletState.account]);
  useEffect(() => {
    void wallet.initializeWallet().catch((error: unknown) => {
      console.error('Wallet initialization failed', error);
    });
  }, [wallet]);
  useEffect(() => { setPanel(false); }, [route]);
  const refresh = () => void client.refresh();
  const run: RunAction = (label, task) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, kind: 'pending', text: `CONFIRM ${label} IN METAMASK…` }]);
    void task().then((result) => {
      if (label === 'Claim faucet' && walletState.account) {
        markFaucetClaimed(walletState.account);
        refresh();
      }
      if (result.hash) saveTransaction(result, label);
      setToasts((items) => items.map((item) => item.id === id
        ? {
          ...item,
          kind: 'success',
          text: `${label.toUpperCase()} COMPLETE`,
          ...(result.hash ? { result } : {}),
        }
        : item));
    }).catch((error: unknown) => {
      const message = toastErrorMessage(error);
      if (label === 'Claim faucet' && message === ALREADY_CLAIMED_TOAST
        && walletState.account) {
        markFaucetClaimed(walletState.account);
        refresh();
      }
      setToasts((items) => items.map((item) => item.id === id
        ? { ...item, kind: 'error', text: message }
        : item));
    });
  };
  const connect = () => void wallet.connect().catch(() => undefined);
  const disconnect = () => { void wallet.disconnect(); setPanel(false); };
  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);
  const content = route === 'sea'
    ? <PlayPage wallet={walletState} snapshot={snapshot} />
    : route === 'harbour'
      ? <HarbourPage snapshot={snapshot} account={walletState.account} />
      : route === 'agora'
        ? <AgoraPage snapshot={snapshot} wallet={walletState} walletApi={wallet}
          onConnect={connect} run={run} onRefresh={refresh} />
        : route === 'boat'
          ? <BoatPage wallet={walletState} walletApi={wallet} snapshot={snapshot}
            onConnect={connect} run={run} onRefresh={refresh} />
          : route === 'replay' ? <ReplayPage /> : <HowPage params={snapshot.params} />;
  return <>
    <TopBar snapshot={snapshot} wallet={walletState} onConnect={connect}
      onOpenPanel={() => setPanel(true)} />
    <SeasonTimeline sea={snapshot.sea} assembly={snapshot.assembly} />
    <AssemblyBar snapshot={snapshot} />
    {content}
    {panel && <WalletPanel wallet={wallet} tideClient={client} snapshot={snapshot}
      onClose={() => setPanel(false)} onDisconnect={disconnect} run={run} />}
    <Toasts toasts={toasts} onDismiss={dismissToast} />
  </>;
}
