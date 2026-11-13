import { useEffect, useState } from 'react';
import type { AssemblyView, SeaView } from '../near/types';
import { assemblyStage, seconds } from './shared';

type Props = { sea: SeaView | null; assembly: AssemblyView | null };

export function SeasonTimeline({ sea, assembly }: Props) {
  const [tip, setTip] = useState<number | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setStarted(Date.now());
    setNow(Date.now());
  }, [sea?.season, sea?.seconds_left_in_season]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!sea) return <div className="timeline timeline-loading">THE SEA CLOCK IS LOADING</div>;
  const current = sea.season;
  const stage = assemblyStage(sea, assembly);
  const countdown = Math.max(0, sea.seconds_left_in_season - Math.floor((now - started) / 1000));
  return (
    <div className="timeline" aria-label="Season timeline">
      <div className="timeline-track">
        {Array.from({ length: 6 }, (_, index) => {
          const day = current + index;
          const assemblyDay = day % 3 === 2;
          const active = index === 0;
          const phase = active && assemblyDay
            ? stage === 'shards'
              ? `FISHING · NAMING ${seconds(countdown)}`
              : stage === 'hold'
                ? `FISHING · VOTE ${seconds(countdown)}`
                : `FISHING · VOTE OPENS ${seconds(countdown)}`
            : active ? `FISHING · ${seconds(countdown)}` : 'FISH';
          const description = assemblyDay
            ? 'You can still fish. The assembly also meets: first half to agree to hold one, '
              + 'second half to name who to banish.'
            : 'Each boat may fish once. Fishing above fair share is publicly indicted.';
          return (
            <button
              className={`timeline-cell ${assemblyDay ? 'is-assembly' : ''} ${active ? 'is-current' : ''}`}
              key={day}
              title={description}
              aria-label={`Day ${day}, ${phase}. ${description}`}
              aria-expanded={tip === day}
              onClick={() => setTip(tip === day ? null : day)}
            >
              <span>DAY {day} · FISH</span>
              {assemblyDay && <small className="assembly-chip">⚖ ASSEMBLY</small>}
              <b>{phase}</b>
              {active && <i style={{
                width: `${Math.max(3, (sea.seconds_left_in_season / sea.season_len_sec) * 100)}%`,
              }} />}
              {active && <small>{seconds(countdown)} LEFT</small>}
              {tip === day && <em className="timeline-tooltip">{description}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
