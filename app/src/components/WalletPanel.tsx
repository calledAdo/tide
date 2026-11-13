import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  CONTRACT,
  EXPLORER,
  nearUnits,
  tideAmountExceedsBalance,
  tideUnits,
} from '../config';
import { formatNear, formatTide } from '../lib/format';
import { historyApi } from '../near/history';
import {
  formatAccountAddress,
  isEthImplicitAccount,
  TideWallet,
  type TransactionResult,
} from '../near/wallet';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import {
  isFaucetClaimedLocally,
  loadTransactions,
  markFaucetClaimed,
  RunAction,
} from './shared';

type WalletPanelProps = {
  wallet: TideWallet;
  tideClient: {
    storageBalance: (account: string) => Promise<Record<string, unknown> | null>;
    storageBounds: () => Promise<{ min: string; max: string | null }>;
  };
  snapshot: TideSnapshot;
  onClose: () => void;
  onDisconnect: () => void;
  run: RunAction;
};

export function WalletPanel({
  wallet,
  tideClient,
  snapshot,
  onClose,
  onDisconnect,
  run,
}: WalletPanelProps) {
  const account = wallet.state.account;
  const boat = account ? snapshot.boats[account] : null;
  const [qr, setQr] = useState('');
  const [copy, setCopy] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [tideAmount, setTideAmount] = useState('');
  const [nearAmount, setNearAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [working, setWorking] = useState('');
  const [localFaucetClaimed, setLocalFaucetClaimed] = useState(false);
  const [indexerFaucetClaimed, setIndexerFaucetClaimed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const faucetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!account) return undefined;
    setLocalFaucetClaimed(isFaucetClaimedLocally(account));
    setIndexerFaucetClaimed(false);
    let live = true;
    const onClaimed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === account) setLocalFaucetClaimed(true);
    };
    window.addEventListener('tide-faucet-claimed', onClaimed);
    void historyApi.faucetClaimed(account).then((claimed) => {
      if (live) setIndexerFaucetClaimed(claimed);
    }).catch(() => undefined);
    return () => {
      live = false;
      window.removeEventListener('tide-faucet-claimed', onClaimed);
    };
  }, [account]);

  useEffect(() => {
    if (account) {
      void QRCode.toDataURL(account, {
        width: 160,
        margin: 1,
        errorCorrectionLevel: 'M',
      }).then(setQr).catch(() => setQr(''));
    }
    panelRef.current?.focus();
    if (snapshot.playerBalance === '0') faucetRef.current?.scrollIntoView({ block: 'start' });
  }, [account, snapshot.playerBalance]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  if (!account) return null;
  const boatBalance = asString(boat?.boat.stake);
  const totalBalance = (
    BigInt(snapshot.playerBalance || '0') + BigInt(boatBalance)
  ).toString();
  const faucetClaimed = localFaucetClaimed
    || indexerFaucetClaimed
    || BigInt(snapshot.playerBalance || '0') > 0n
    || BigInt(asString(boat?.boat.stake)) > 0n;
  const transferTooMuch = tideAmountExceedsBalance(tideAmount, snapshot.playerBalance);
  const topupTooMuch = tideAmountExceedsBalance(topupAmount, snapshot.playerBalance);
  const exile = boat?.exiled_until;
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopy('Copied');
      window.setTimeout(() => setCopy(''), 1500);
    } catch {
      setCopy('Copy unavailable');
    }
  };
  const execute = (
    name: string,
    task: () => Promise<TransactionResult>,
    onSuccess?: () => void,
  ) => {
    setWorking(name);
    run(name, async () => {
      const result = await task();
      onSuccess?.();
      return result;
    });
    window.setTimeout(() => setWorking(''), 700);
  };
  const isMetaMaskAccount = !wallet.state.dev && isEthImplicitAccount(account);

  return (
    <div
      className="wallet-panel-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="wallet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="wallet-head">
          <div>
            <p className="eyebrow">ACCOUNT / TESTNET</p>
            <h2 id="wallet-title">Wallet</h2>
          </div>
          <button className="icon-button" aria-label="Close wallet panel" onClick={onClose}>×</button>
        </div>
        <section className="wallet-section">
          <div className="section-title">
            <h3>Address</h3>
            <a href={`${EXPLORER}/address/${account}`} target="_blank" rel="noreferrer">
              EXPLORER ↗
            </a>
          </div>
          <div className="address-line">
            <code>{account}</code>
            <button onClick={() => void copyAddress()}>COPY</button>
          </div>
          {isMetaMaskAccount && (
            <p className="wallet-note">
              Controlled by your MetaMask <code>{formatAccountAddress(account)}</code>
            </p>
          )}
        </section>
        <section className="wallet-section">
          <h3>Balances</h3>
          <dl className="balance-list">
            <div><dt>NEAR for gas</dt><dd>{formatNear(snapshot.nearBalance)}</dd></div>
            <div className="balance-pair">
              <div><dt>TIDE in wallet</dt><dd>{formatTide(snapshot.playerBalance)}</dd></div>
              <div><dt>TIDE in your boat</dt><dd>{formatTide(boatBalance)}</dd></div>
            </div>
            <div><dt>TOTAL TIDE</dt><dd>{formatTide(totalBalance)}</dd></div>
            <div>
              <dt>STATUS</dt>
              <dd>
                {exile
                  ? `EXILED UNTIL S${exile}`
                  : boat?.boat.indicted_cycle !== null
                    ? 'INDICTED'
                    : 'FAIR'}
              </dd>
            </div>
          </dl>
        </section>
        <section className="wallet-section" id="test-tide" ref={faucetRef}>
          <h3>GET TEST TIDE <small>· TESTNET ONLY</small></h3>
          <div className="deposit-layout">
            <div>
              <p className="wallet-note">Send NEAR or TIDE on NEAR testnet to this address.</p>
              <div className="address-line">
                <code>{formatAccountAddress(account)}</code>
                <button onClick={() => void copyAddress()}>COPY</button>
              </div>
              <button
                className="secondary wallet-action"
                disabled={wallet.state.dev || Boolean(working)}
                onClick={() => execute(
                  'Get test NEAR',
                  () => wallet.onboard().then(() => ({ hash: '', url: '' })),
                )}
              >
                GET TEST NEAR · GAS
              </button>
              {faucetClaimed ? (
                <button className="secondary wallet-action" disabled>
                  TEST TIDE CLAIMED ✓
                </button>
              ) : (
                <button
                  className="secondary wallet-action"
                  disabled={wallet.state.dev || Boolean(working)}
                  onClick={() => execute(
                    'Claim faucet',
                    () => wallet.call('claim_faucet'),
                    () => {
                      markFaucetClaimed(account);
                      setLocalFaucetClaimed(true);
                    },
                  )}
                >
                  GET TEST TIDE · TESTNET ONLY
                </button>
              )}
            </div>
            {qr && <img className="wallet-qr" src={qr} alt="QR code for NEAR deposit address" />}
          </div>
        </section>
        <section className="wallet-section">
          <h3>Withdraw</h3>
          <div className="wallet-form">
            <label>
              TIDE AMOUNT
              <input
                value={tideAmount}
                onChange={(event) => setTideAmount(event.target.value)}
                placeholder="1000"
              />
            </label>
            <label>
              RECIPIENT
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="name.testnet or 0x…"
              />
            </label>
            <button
              className="secondary wallet-action"
              disabled={wallet.state.dev || !tideAmount || !recipient
                || transferTooMuch || Boolean(working)}
              onClick={() => execute('Send TIDE', async () => {
                const target = recipient.trim();
                const registered = await tideClient.storageBalance(target);
                if (!registered) {
                  setTransferNote('Registering the recipient first…');
                  const bounds = await tideClient.storageBounds();
                  await wallet.call('storage_deposit', {
                    account_id: target,
                    registration_only: true,
                  }, BigInt(bounds.min));
                }
                setTransferNote('Sending TIDE…');
                return wallet.call('ft_transfer', {
                  receiver_id: target,
                  amount: tideUnits(tideAmount).toString(),
                  memo: 'TIDE transfer',
                }, 1n);
              })}
            >
              SEND TIDE · 1 YOCTO
            </button>
            {transferTooMuch && (
              <p className="wallet-note">
                You have {formatTide(snapshot.playerBalance)} in your wallet
              </p>
            )}
            <label>
              NEAR AMOUNT
              <input
                value={nearAmount}
                onChange={(event) => setNearAmount(event.target.value)}
                placeholder="0.1"
              />
            </label>
            <button
              className="secondary wallet-action"
              disabled={wallet.state.dev || !nearAmount || !recipient || Boolean(working)}
              onClick={() => execute(
                'Send NEAR',
                () => wallet.transferNear(recipient.trim(), nearUnits(nearAmount)),
              )}
            >
              SEND NEAR
            </button>
          </div>
          {transferNote && <p className="wallet-note" role="status">{transferNote}</p>}
        </section>
        <section className="wallet-section">
          <h3>Your boat</h3>
          <dl className="balance-list">
            <div><dt>STAKE</dt><dd>{formatTide(asString(boat?.boat.stake))}</dd></div>
            <div><dt>LAST FISHED</dt><dd>{boat?.boat.last_fished ?? '—'}</dd></div>
            <div><dt>INDICTED CYCLE</dt><dd>{boat?.boat.indicted_cycle ?? '—'}</dd></div>
            <div><dt>EXILE</dt><dd>{exile ? `UNTIL S${exile}` : '—'}</dd></div>
          </dl>
          <div className="wallet-form">
            <label>
              TOP UP TIDE
              <input
                value={topupAmount}
                onChange={(event) => setTopupAmount(event.target.value)}
                placeholder="1000"
              />
            </label>
            <button
              className="secondary wallet-action"
              disabled={!topupAmount || topupTooMuch || Boolean(working)}
              onClick={() => execute('Top up boat', () => wallet.call('stake', {
                amount: tideUnits(topupAmount).toString(),
              }))}
            >
              TOP UP BOAT
            </button>
            {topupTooMuch && (
              <p className="wallet-note">
                You have {formatTide(snapshot.playerBalance)} in your wallet
              </p>
            )}
            <label>
              UNSTAKE TIDE
              <input
                value={unstakeAmount}
                onChange={(event) => setUnstakeAmount(event.target.value)}
                placeholder="1000"
              />
            </label>
            <button
              className="secondary wallet-action"
              disabled={!unstakeAmount || Boolean(working)}
              onClick={() => execute('Unstake boat', () => wallet.call('unstake', {
                amount: tideUnits(unstakeAmount).toString(),
              }))}
            >
              UNSTAKE AMOUNT
            </button>
          </div>
        </section>
        <section className="wallet-section">
          <h3>Your transactions</h3>
          {loadTransactions().slice(0, 10).map((record) => (
            <p className="wallet-tx" key={`${record.hash}-${record.time}`}>
              <b>{record.label}</b>
              <a href={record.url} target="_blank" rel="noreferrer">
                {formatAccountAddress(record.hash)}
              </a>
            </p>
          ))}
          {copy && <p className="wallet-note" role="status">{copy}</p>}
        </section>
        <footer className="wallet-footer">
          <span role="status">
            {wallet.state.error || (wallet.state.dev ? 'DEV SIGNER · LOCALHOST ONLY' : 'MetaMask connected')}
          </span>
          <button className="secondary" onClick={onDisconnect}>DISCONNECT</button>
        </footer>
      </aside>
    </div>
  );
}
