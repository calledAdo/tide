import { useEffect, useState } from 'react';
import type { TideSnapshot } from '../near/types';
import { asString } from '../near/types';
import { historyApi, type LeaderboardRow } from '../near/history';
import { formatTide, unitsToNumber, TIDE_DECIMALS } from '../lib/format';
import { shortName } from './shared';
import { CaptainCard } from './CaptainCard';

type Props = { snapshot: TideSnapshot; account?: string };
type Filter = 'ALL' | 'FISHING' | 'INDICTED' | 'EXILED';

export function HarbourPage({ snapshot, account }: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<'stake' | 'catch' | 'indictments'>('stake');
  const [selected, setSelected] = useState<string | null>(null);
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
    const status = exile && exile > (snapshot.sea?.season ?? 0)
      ? 'EXILED'
      : currentIndictment
        ? 'INDICTED'
        : boat?.can_fish_now
          ? 'FISHING'
          : 'IDLE';
    return {
      name,
      boat,
      data,
      exile,
      status,
      stake: Number(asString(boat?.boat.stake)),
      catch: unitsToNumber(data?.catch ?? 0, TIDE_DECIMALS),
      indictments: Number(data?.indictments ?? 0),
    };
  }).filter((row) => filter === 'ALL' || row.status === filter).sort((a, b) => {
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
            </span>
            <span>{formatTide(asString(row.boat?.boat.stake))}</span>
            <span>{row.data?.catch !== undefined ? formatTide(row.data.catch) : '—'}</span>
            <span>{row.data?.net !== undefined ? formatTide(row.data.net) : '—'}</span>
            <span>{row.data?.trips ?? '—'}</span>
            <span className={row.status === 'EXILED'
              ? 'danger-text' : row.status === 'INDICTED' ? 'amber-text' : ''}>
              {row.status}
              {row.exile && row.status === 'EXILED' ? ` · DAY ${row.exile}` : ''}
            </span>
          </button>
        ))}
      </div>
      <section className="exile-block">
        <p className="eyebrow">EXILE ISLAND</p>
        <h2>BEACHED CAPTAINS</h2>
        <div className="exile-list">
          {snapshot.exiles
            .filter(([, until]) => until > (snapshot.sea?.season ?? 0))
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
