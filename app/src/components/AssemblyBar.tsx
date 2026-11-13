import { useEffect, useState } from 'react';
import type { TideSnapshot } from '../near/types';
import { assemblyStage, seconds } from './shared';

export function AssemblyBar({ snapshot }: { snapshot: TideSnapshot }) {
  const sea = snapshot.sea;
  const stage = assemblyStage(sea, snapshot.assembly);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setStarted(Date.now());
    setNow(Date.now());
  }, [sea?.season, sea?.seconds_left_in_season, stage]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!sea) return null;
  const elapsed = Math.floor((now - started) / 1000);
  const countdown = seconds(Math.max(0, sea.seconds_left_in_season - elapsed));
  const dayInCycle = sea.season % 3;
  const days = stage ? 0 : dayInCycle === 0 ? 2 : dayInCycle === 1 ? 1 : 3;
  const next = `${days} DAY${days === 1 ? '' : 'S'} · ${seconds(
    days * sea.season_len_sec + Math.max(0, sea.seconds_left_in_season - elapsed),
  )}`;
  const open = stage === 'hold'
    ? 'SHOULD ANYONE BE BANISHED TODAY?'
    : 'NAME WHO TO BANISH';
  return (
    <section className={`assembly-bar ${stage ? 'is-open' : ''}`} aria-label="Assembly status">
      <div>
        <p className="eyebrow">THE ASSEMBLY · {stage ? 'OPEN NOW' : 'NEXT UP'}</p>
        <b>{stage ? stage === 'hold' ? 'HOLD VOTE' : 'NAMING' : `NEXT ASSEMBLY IN ${next}`}</b>
        <small>
          {stage
            ? `${open} · ${snapshot.indictments.length} accused boat${
              snapshot.indictments.length === 1 ? '' : 's'}`
            : `${snapshot.indictments.length} on the current docket`}
        </small>
      </div>
      {stage && (
        <div className="assembly-bar-countdown">{stage === 'hold' ? 'VOTE' : 'NAME'} · {countdown}</div>
      )}
      {stage && (
        <a className="primary" href="#/agora">
          {stage === 'hold' ? 'VOTE IN THE AGORA' : 'NAME IN THE AGORA'}
        </a>
      )}
    </section>
  );
}
