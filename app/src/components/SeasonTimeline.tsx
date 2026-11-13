import { useState } from 'react';
import type { AssemblyView, SeaView } from '../near/types';
import { assemblyStage, seconds } from './shared';

type Props = { sea: SeaView | null; assembly: AssemblyView | null };

export function SeasonTimeline({ sea, assembly }: Props) {
  const [tip, setTip] = useState<number | null>(null);
  if (!sea) return <div className="timeline timeline-loading">THE SEA CLOCK IS LOADING</div>;
  const current = sea.season;
  const stage = assemblyStage(sea, assembly);
  return (
    <div className="timeline" aria-label="Season timeline">
      <div className="timeline-track">
        {Array.from({ length: 6 }, (_, index) => {
          const day = current + index;
          const assemblyDay = day % 3 === 2;
          const active = index === 0;
          const phase = active
            ? assemblyDay ? stage?.toUpperCase() ?? 'VOTE' : 'FISHING'
            : assemblyDay ? 'ASSEMBLY' : 'FISH';
          const description = assemblyDay
            ? 'Assembly: vote in the first half, write up to three names in the second half.'
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
              <span>DAY {day} · {assemblyDay ? '⚖ ASSEMBLY' : 'FISH'}</span>
              <b>{active ? phase : assemblyDay ? 'ASSEMBLY' : 'FISH'}</b>
              {active && <i style={{
                width: `${Math.max(3, (sea.seconds_left_in_season / sea.season_len_sec) * 100)}%`,
              }} />}
              {active && <small>{seconds(sea.seconds_left_in_season)} LEFT</small>}
              {tip === day && <em className="timeline-tooltip">{description}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
