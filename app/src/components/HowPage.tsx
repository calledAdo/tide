import { CONTRACT, EXPLORER } from '../config';
import type { Params } from '../near/types';

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

export function HowPage({ params }: { params: Params | null }) {
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
