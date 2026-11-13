import { useEffect, useState } from 'react';
import type { TideSnapshot } from '../near/types';
import { asString, boatHasHistory } from '../near/types';
import { CONTRACT } from '../config';
import { historyApi, type LeaderboardRow } from '../near/history';
import { formatTide, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { shortName } from './shared';
import { CaptainCard } from './CaptainCard';
import { readBotAccounts } from '../near/bots';

type Props = { snapshot: TideSnapshot; account?: string };
type Filter = 'ALL' | 'FISHING' | 'INDICTED' | 'EXILED';
type Status = Filter
  | 'IDLE'
  | 'FISHED TODAY'
  | `INDICTED ${string}×`
  | `EXILED UNTIL DAY ${number}`;

export function HarbourPage({ snapshot, account }: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<'stake' | 'catch' | 'indictments'>('stake');
  const [selected, setSelected] = useState<string | null>(null);
  const [bots, setBots] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void readBotAccounts().then((items) => { if (live) setBots(items); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    void historyApi.leaderboard('catch').then((rows) => {
      if (live) setLeaderboard(rows);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const names = new Set([...Object.keys(snapshot.boats), ...leaderboard.map((row) => row.account)]);
  const rows = [...names].map((name) => {
    const boat = snapshot.boats[name];
    const data = leaderboard.find((row) => row.account === name);
    const exile = snapshot.exiles.find(([item]) => item === name)?.[1] ?? boat?.exiled_until ?? null;
    const currentIndictment = snapshot.indictments.some(([item]) => item === name);
    const stake = Number(asString(boat?.boat.stake));
    const overage = snapshot.indictments.find(([item]) => item === name)?.[1];
    const fairShare = Number(asString(boat?.fair_share));
    const ratio = fairShare > 0 && overage !== undefined
      ? (1 + Number(asString(overage)) / fairShare).toFixed(1)
      : '0.0';
    const status: Status = stake <= 0
      ? 'IDLE'
      : exile && exile > (snapshot.sea?.season ?? 0)
        ? `EXILED UNTIL DAY ${exile}`
      : currentIndictment
        ? `INDICTED ${ratio}×`
        : boat?.boat.last_fished === snapshot.sea?.season
          ? 'FISHED TODAY'
        : boat?.can_fish_now
          ? 'FISHING'
          : 'FISHED TODAY';
    const statusKey: Filter = status.startsWith('EXILED')
      ? 'EXILED'
      : status.startsWith('INDICTED')
        ? 'INDICTED'
        : status === 'FISHING' ? 'FISHING' : 'ALL';
    return {
      name,
      boat,
      data,
      exile,
      status,
      statusKey,
      stake,
      catch: unitsToNumber(data?.catch ?? 0, TIDE_DECIMALS),
      indictments: Number(data?.indictments ?? 0),
    };
  }).filter((row) => row.name !== CONTRACT && (row.stake > 0 || row.data || boatHasHistory(row.boat)))
    .filter((row) => filter === 'ALL' || row.statusKey === filter).sort((a, b) => {
    const first = sort === 'stake' ? a.stake : sort === 'catch' ? a.catch : a.indictments;
    const second = sort === 'stake' ? b.stake : sort === 'catch' ? b.catch : b.indictments;
    return second - first;
  });
  const ordered = rows.sort((a, b) => a.name === account ? -1 : b.name === account ? 1 : 0);
  const selectedRow = selected ? rows.find((row) => row.name === selected) : null;
  return (
    <main className="route-page harbour-page">
      <div className="route-heading">
        <div>
          <p className="eyebrow">PORT AUTHORITY · ALL KNOWN CAPTAINS</p>
          <h1>THE HARBOUR</h1>
        </div>
        <span>{rows.length} BOATS</span>
      </div>
      <div className="table-tools">
        <div className="segmented">
          {(['ALL', 'FISHING', 'INDICTED', 'EXILED'] as Filter[]).map((item) => (
            <button
              key={item}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label>
          SORT
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="stake">STAKE</option>
            <option value="catch">CATCH</option>
            <option value="indictments">INDICTMENTS</option>
          </select>
        </label>
      </div>
      {failed && <p className="history-note">History is catching up. On-chain boats are still shown.</p>}
      {!failed && !leaderboard.length && (
        <p className="history-note">Loading indexed captains…</p>
      )}
      <div className="harbour-table" role="table" aria-label="Known captains">
        <div className="harbour-row harbour-head" role="row">
          <span>HULL / CAPTAIN</span><span>STAKE</span><span>TOTAL CATCH</span>
          <span>NET</span><span>TRIPS</span><span>STATUS</span>
        </div>
        {ordered.map((row) => (
          <button
            className={`harbour-row ${row.name === account ? 'is-you' : ''}`}
            key={row.name}
            onClick={() => setSelected(row.name)}
            role="row"
          >
            <span>
              <b className={`tier-mark ${row.stake >= 1_000_000e18
                ? 'factory' : row.stake >= 50_000e18 ? 'trawler' : 'dinghy'}`}>
                {row.stake >= 1_000_000e18 ? 'F' : row.stake >= 50_000e18 ? 'T' : 'D'}
              </b>
              {shortName(row.name)}
              {row.name === account && <em>YOU</em>}
              {bots.has(row.name) && (
                <em
                  className="bot-tag"
                  title={'a demo captain run by the project\'s server; the contract treats it '
                    + 'like any other account'}
                >BOT</em>
              )}
            </span>
            <span>{formatTide(asString(row.boat?.boat.stake))}</span>
            <span>{row.data?.catch !== undefined ? formatTide(row.data.catch) : '—'}</span>
            <span>{row.data?.net !== undefined ? formatTide(row.data.net) : '—'}</span>
            <span>{row.data?.trips ?? '—'}</span>
            <span className={row.statusKey === 'EXILED'
              ? 'danger-text' : row.statusKey === 'INDICTED' ? 'amber-text' : ''}>
              {row.status}
            </span>
          </button>
        ))}
      </div>
      <section className="exile-block">
        <p className="eyebrow">EXILE ISLAND</p>
        <h2>BEACHED CAPTAINS</h2>
        <div className="exile-list">
          {snapshot.exiles
            .filter(([name, until]) => name !== CONTRACT && until > (snapshot.sea?.season ?? 0))
            .map(([name, until]) => (
              <button key={name} onClick={() => setSelected(name)}>
                <b>{shortName(name)}</b>
                <span>UNTIL DAY {until}</span>
                <small>CYCLE {snapshot.boats[name]?.boat.indicted_cycle ?? '—'}</small>
              </button>
            ))}
          {!snapshot.exiles.length && <p>No current exiles. The island is empty.</p>}
        </div>
      </section>
      {selectedRow && (
        <CaptainCard
          account={selectedRow.name}
          boat={selectedRow.boat ?? null}
          snapshot={snapshot}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
