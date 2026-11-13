import { useEffect } from 'react';
import { CONTRACT, EXPLORER } from '../config';
import type { Params, ReckoningView, SeaView } from '../near/types';
import { asString } from '../near/types';
import { compactNumber, formatTide } from '../lib/format';

const lessons = [
  ['01', 'CLAIM THE WATER', 'Claim 100,000 TIDE once, then turn it into a boat.'],
  [
    '02',
    'BUILD WITH SKIN IN THE GAME',
    'Stake at least 1,000 TIDE. One percent burns and your hull starts next season.',
  ],
  ['03', 'FISH A FAIR SHARE', 'Effort mints catch and burns fuel. Greed becomes a public indictment.'],
  [
    '04',
    'ASSEMBLE EVERY THIRD SEASON',
    'Hold an ostracism by majority, then write up to three names on a shard.',
  ],
  [
    '05',
    'KEEP THE SEA ALIVE',
    'The stock regrows until it falls below 120,000 fish. Below that, it is dead.',
  ],
] as const;

export function HowPage({
  params,
  sea,
  reckoning,
}: {
  params: Params | null;
  sea: SeaView | null;
  reckoning: ReckoningView | null;
}) {
  useEffect(() => {
    if (location.hash.includes('generations')) {
      document.getElementById('generations')?.scrollIntoView();
    }
  }, []);

  return (
    <main className="how-page">
      <p className="eyebrow">$TIDE · FIELD NOTES</p>
      <h1>HOW THE SEA<br />WORKS.</h1>
      <div className="how-rows">
        {lessons.map(([number, title, copy]) => (
          <article key={number}>
            <b>{number}</b>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <div className="parameter-block">
        <div>
          <p className="eyebrow">LIVE PARAMETERS</p>
          <h2>THE RULES ARE ON CHAIN.</h2>
        </div>
        <dl>
          {params ? (
            Object.entries(params)
              .filter(([key]) => key !== 'admin')
              .slice(0, 12)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll('_', ' ')}</dt>
                  <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))
          ) : (
            <div><dt>get_params</dt><dd>CONNECTING…</dd></div>
          )}
        </dl>
      </div>
      <section className="wreck-exhibit generations" id="generations">
        <p className="eyebrow">THE IMMUTABLE LEDGER · LIVE FROM GET_RECKONING()</p>
        <h2>THE GENERATIONS.</h2>
        <p>
          Every collapse is recorded here. A funded reseed starts the next sea at 70% of its
          then-capacity; a missed deadline limps back near the point of no return. Each generation
          is permanently smaller, so the community can still lose the game for ever.
        </p>
        <div className="generation-ledger" role="table" aria-label="Generation history">
          <div className="generation-row generation-head" role="row">
            <span>GEN</span><span>DIED</span><span>BOATS</span><span>TIDE BURNED</span>
            <span>RESEED</span><span>CAPACITY THAT FOLLOWED</span>
          </div>
          {!reckoning?.history.length && (
            <p className="generation-empty">No generation has wrecked yet.</p>
          )}
          {reckoning?.history.map((item) => {
            const nextGeneration = reckoning.generation === item.generation + 1;
            const nextCapacity = nextGeneration && sea
              ? Number(asString(sea.carrying_capacity))
              : null;
            return (
              <div
                className="generation-row"
                role="row"
                key={`${item.generation}-${item.died_season}`}
              >
                <span>{item.generation}</span>
                <span>DAY {item.died_season}</span>
                <span>{item.boats_wrecked}</span>
                <span>{formatTide(asString(item.burned_total))}</span>
                <span className={item.funded ? 'funded' : 'missed'}>
                  {item.reseeded_season === null ? 'PENDING' : item.funded ? 'FUNDED' : 'MISSED'}
                </span>
                <span>
                  {nextCapacity !== null
                    ? `${compactNumber(nextCapacity)} FISH`
                    : item.funded ? '70% OF THEN-CAPACITY' : 'NEAR POINT OF NO RETURN'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="wreck-change">
          A final grab is worth ~8,000 TIDE. A wreck costs ~4.95M TIDE: collapse is ~594× against
          the raider. The punishment is collective because the fleet must police itself.
        </p>
        <div className="wreck-links">
          <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
            CURRENT GENERATION ON EXPLORER ↗
          </a>
          <a href="#/replay?scenario=lawless">REPLAY · LAWLESS SEA ↗</a>
        </div>
      </section>
      <div className="why-near">
        <b>WHY NEAR</b>
        <p>
          Account names make a shard readable. Low-cost seasons keep the ritual playable, and the
          contract is keyless after deployment.
        </p>
        <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
          CONTRACT ON EXPLORER ↗
        </a>
        <a href="https://github.com/" target="_blank" rel="noreferrer">REPOSITORY ↗</a>
        <a href="#/replay">SIMULATION ↗</a>
      </div>
    </main>
  );
}
