import { useEffect, useState } from 'react';
import { compactNumber } from '../lib/format';
import { TideSim, type SimEngine } from '../sim/engine';
import { shortName } from './shared';

export function ReplayPage() {
  const initialScenario = new URLSearchParams(location.hash.split('?')[1] ?? '').get('scenario');
  const scenarioId = TideSim.SCENARIOS.some((item) => item.id === initialScenario)
    ? initialScenario!
    : 'tide';
  const [scenario, setScenario] = useState(scenarioId);
  const [engine, setEngine] = useState<SimEngine>(() => TideSim.create(scenarioId));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [history, setHistory] = useState<number[]>([engine.state.stock]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      for (let index = 0; index < speed; index += 1) engine.step();
      setHistory((values) => [...values, engine.state.stock]);
      if (engine.season >= TideSim.constants.SEASONS) setPlaying(false);
    }, 500);
    return () => window.clearInterval(timer);
  }, [engine, playing, speed]);

  const restart = (id = scenario) => {
    const fresh = TideSim.create(id);
    setEngine(fresh);
    setHistory([fresh.state.stock]);
    setPlaying(false);
    setScenario(id);
  };
  const path = history
    .map((value, index) => {
      const x = 10 + (index / Math.max(1, history.length - 1)) * 680;
      const y = 260 - (value / TideSim.constants.K) * 220;
      return `${index ? 'L' : 'M'}${x} ${y}`;
    })
    .join(' ');

  return (
    <main className="replay-page">
      <div className="replay-head">
        <div>
          <p className="eyebrow">THE VERIFIED ENGINE · 60 SECOND REPLAY</p>
          <h1>WATCH THE SEA<br />MAKE ITS CASE.</h1>
        </div>
        <div className="replay-controls">
          <button className="primary" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
            {playing ? 'PAUSE' : 'PLAY'}
          </button>
          <button onClick={() => restart()}>RESTART</button>
          <div className="speed-buttons">
            {[1, 4].map((value) => (
              <button key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                {value}×
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="scenario-strip">
        {TideSim.SCENARIOS.map((item) => (
          <button
            key={item.id}
            aria-pressed={scenario === item.id}
            onClick={() => restart(item.id)}
          >
            <b>{item.label}</b>
            <span>{item.blurb}</span>
          </button>
        ))}
      </div>
      <div className="replay-grid">
        <div className="replay-chart">
          <div className="chart-labels">
            <span>STOCK</span>
            <b>SEASON {engine.season}</b>
            <span>{compactNumber(engine.state.stock)} FISH</span>
          </div>
          <svg viewBox="0 0 700 300" role="img" aria-label="Simulation stock chart">
            <line x1="10" y1="234" x2="690" y2="234" className="chart-rule" />
            <line x1="10" y1="234" x2="690" y2="234" className="danger-rule" />
            <path d={path} />
          </svg>
          <div className="chart-legend">
            <span className="signal-mark">STOCK</span>
            <span className="danger-mark">POINT OF NO RETURN 120K</span>
          </div>
        </div>
        <aside className="replay-rail">
          <div><span>FISH STOCK</span><strong>{compactNumber(engine.state.stock)}</strong></div>
          <div><span>FLEET MINTED</span><strong>{compactNumber(engine.state.minted)}</strong></div>
          <div><span>FUEL BURNED</span><strong>{compactNumber(engine.state.burned)}</strong></div>
          <div className={engine.state.dead ? 'dead-readout' : ''}>
            <span>SEA STATUS</span>
            <strong>{engine.state.dead ? 'DEAD' : 'ALIVE'}</strong>
          </div>
        </aside>
      </div>
      <div className="replay-bottom">
        <section>
          <p className="eyebrow">FLEET · SEASON {engine.season}</p>
          {engine.state.boats.slice(0, 10).map((boat) => (
            <div className="replay-boat" key={boat.name}>
              <b>{shortName(boat.name)}</b>
              <span className={boat.status === 'INDICTED' ? 'amber' : ''}>{boat.status}</span>
              <strong>{compactNumber(boat.lastCatch)}</strong>
            </div>
          ))}
        </section>
        <section>
          <p className="eyebrow">LOG</p>
          {engine.events.slice(0, 8).map((event) => (
            <p className="replay-event" key={`${event.season}-${event.text}`}>
              <b>S{event.season}</b>{event.text}
            </p>
          ))}
        </section>
      </div>
      {engine.state.dead && <div className="death-stamp replay-stamp">THE SEA<br />IS DEAD</div>}
    </main>
  );
}
