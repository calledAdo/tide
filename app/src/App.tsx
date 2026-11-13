import { useEffect, useRef, useState } from 'react';
import { CONTRACT, EXPLORER } from './config';
import { TideClient } from './near/tide';
import { TideWallet, type TransactionResult, type WalletSnapshot } from './near/wallet';
import { historyApi } from './near/history';
import type { TideSnapshot } from './near/types';
import { HowPage } from './components/HowPage';
import { PlayPage } from './routes/SeaRoute';
import { HarbourPage } from './routes/HarbourRoute';
import { AgoraPage } from './routes/AgoraRoute';
import { BoatPage } from './routes/BoatRoute';
import { ReplayPage } from './components/ReplayPage';
import { TopBar } from './components/TopBar';
import { SeasonTimeline } from './components/SeasonTimeline';
import { NotificationStrip } from './components/NotificationStrip';
import { Toasts } from './components/Toasts';
import { WalletPanel } from './components/WalletPanel';
import { loadTransactions, type RunAction, type Toast } from './components/shared';
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

export default function App() {
  const route = useRoute();
  const [wallet] = useState(() => new TideWallet());
  const [client] = useState(() => new TideClient());
  const [walletState, setWalletState] = useState<WalletSnapshot>(wallet.state);
  const [snapshot, setSnapshot] = useState<TideSnapshot>(client.state);
  const [panel, setPanel] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const previous = useRef<TideSnapshot | null>(null);
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
  useEffect(() => {
    const old = previous.current;
    if (old && snapshot.sea && snapshot.sea.assembly && !old.sea?.assembly) {
      setToasts((items) => [...items, { id: Date.now(), kind: 'pending', text: 'ASSEMBLY IS STARTING' }]);
    }
    const account = walletState.account;
    const oldBoat = account ? old?.boats[account] : null;
    const newBoat = account ? snapshot.boats[account] : null;
    if (oldBoat && newBoat && oldBoat.boat.indicted_cycle === null && newBoat.boat.indicted_cycle !== null) {
      setToasts((items) => [...items, { id: Date.now() + 1, kind: 'error', text: 'YOU WERE INDICTED' }]);
    }
    if (oldBoat && newBoat && !oldBoat.exiled_until && newBoat.exiled_until) {
      setToasts((items) => [...items, {
        id: Date.now() + 2,
        kind: 'error',
        text: `YOU WERE EXILED UNTIL DAY ${newBoat.exiled_until}`,
      }]);
    }
    previous.current = snapshot;
  }, [snapshot, walletState.account]);
  useEffect(() => {
    let live = true;
    const readEvents = () => void historyApi.events('?limit=8').then((events) => {
      if (!live || !events.length) return;
      const recent = events.slice(-3).flatMap((event, index) => {
        const label = String(event.event ?? event.type ?? 'EVENT').replace(/_/g, ' ').toUpperCase();
        return [{ id: Date.now() + index, kind: 'success' as const, text: label }];
      });
      setToasts((items) => [...items, ...recent].slice(-8));
    }).catch(() => undefined);
    readEvents();
    const timer = window.setInterval(readEvents, 30_000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const run: RunAction = (label, task) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, kind: 'pending', text: `CONFIRM ${label} IN METAMASK…` }]);
    void task().then((result) => {
      if (result.hash) saveTransaction(result, label);
      setToasts((items) => items.map((item) => item.id === id
        ? {
          ...item,
          kind: 'success',
          text: `${label.toUpperCase()} COMPLETE`,
          ...(result.hash ? { result } : {}),
        }
        : item));
    }).catch((error: unknown) => setToasts((items) => items.map((item) => item.id === id
      ? {
        ...item,
        kind: 'error',
        text: error instanceof Error ? error.message : 'Transaction failed.',
      }
      : item)));
  };
  const connect = () => void wallet.connect().catch(() => undefined);
  const refresh = () => void client.refresh();
  const disconnect = () => { void wallet.disconnect(); setPanel(false); };
  const content = route === 'sea'
    ? <PlayPage wallet={walletState} walletApi={wallet} snapshot={snapshot}
      onConnect={connect} onOpenWallet={() => setPanel(true)} run={run} onRefresh={refresh} />
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
    <NotificationStrip items={toasts} />
    {content}
    {panel && <WalletPanel wallet={wallet} tideClient={client} snapshot={snapshot}
      onClose={() => setPanel(false)} onDisconnect={disconnect} run={run} />}
    <Toasts toasts={toasts}
      onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
  </>;
}
