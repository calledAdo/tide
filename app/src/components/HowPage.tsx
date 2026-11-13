import { useEffect } from 'react';
import { CONTRACT, DEAD_SEA, EXPLORER } from '../config';
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
  useEffect(() => {
    if (location.hash.includes('first-sea-died')) {
      document.getElementById('first-sea-died')?.scrollIntoView();
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
      <section className="wreck-exhibit" id="first-sea-died">
        <p className="eyebrow">ON-CHAIN EXHIBIT · SEASON {DEAD_SEA.diedSeason}</p>
        <h2>THE FIRST SEA DIED.</h2>
        <p>
          The first $TIDE sea is dead. Six demo captains fished it a little harder than it could
          regrow, about 77,500 fish a season against 73,155 of growth. The gap compounded, the
          stock crossed the point of no return, and on day 1103 the contract stopped minting for
          ever. Nothing can restart it: the rule is in the contract and the contract has no keys.
        </p>
        <p>Its final stock was 28 fish.</p>
        <p>That is the whole thesis, demonstrated on a public chain rather than in a simulation.</p>
        <div className="wreck-links">
          <a href={`${EXPLORER}/address/${DEAD_SEA.contract}`} target="_blank" rel="noreferrer">
            DEAD CONTRACT ON EXPLORER ↗
          </a>
          <a href="#/replay?scenario=lawless">REPLAY · LAWLESS SEA ↗</a>
        </div>
        <p className="wreck-change">
          What changed: the demo bots now fish inside the sea&apos;s growth and stop entirely below
          twice the point of no return; human players are not limited.
        </p>
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
