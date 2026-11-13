import type { AssemblyView, SeaView } from '../near/types';
import { assemblyStage, shortName } from './shared';

export function AssemblyTab({
  assembly,
  sea,
}: {
  assembly: AssemblyView | null;
  sea: SeaView | null;
}) {
  const stage = assemblyStage(sea, assembly);
  return (
    <div className="tab-content">
      {assembly ? (
        <>
          <p className="eyebrow">
            CYCLE {assembly.cycle} · {stage ?? 'CLOSED'}
          </p>
          <h3>
            {assembly.last_result
              ? `${assembly.last_result.held ? 'OSTRACISM HELD' : 'NO OSTRACISM'} ·
                ${assembly.last_result.exiled.length} EXILED`
              : 'ASSEMBLY IN PROGRESS'}
          </h3>
          <p>
            Eligible {assembly.eligible} · Votes {assembly.hold_yes}-{assembly.hold_no} ·
            {' '}Shard quorum {assembly.quorum_shards}
          </p>
          {assembly.last_result?.exiled.map((name) => (
            <span className="inline-result" key={name}>
              RETURNED SEASON {shortName(name)}
            </span>
          ))}
        </>
      ) : (
        <p>Assembly data is loading.</p>
      )}
    </div>
  );
}
