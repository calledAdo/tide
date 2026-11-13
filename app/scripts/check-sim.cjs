'use strict';

require('../src/sim/sim.js');
const TideSim = globalThis.TideSim;

const expected = {
  lawless: { final: 78, deadAt: 9, exiles: 0, wrong: 0, edge: null, apr: 20.6 },
  tide: { final: 931909, deadAt: null, exiles: 50, wrong: 0, edge: null, apr: 178.7 },
  'faction-naive': { final: 896332, deadAt: null, exiles: 120, wrong: 120, edge: 3.44, apr: 23.3 },
  'faction-tide': { final: 896332, deadAt: null, exiles: 0, wrong: 0, edge: 1.00, apr: 23.3 }
};

let failed = false;
for (const scenario of TideSim.SCENARIOS) {
  const actual = TideSim.runToEnd(scenario.id);
  const want = expected[scenario.id];
  const checks = [
    Math.abs(actual.final - want.final) <= 1,
    actual.deadAt === want.deadAt,
    actual.exiles === want.exiles,
    actual.wrong === want.wrong,
    Math.abs(actual.apr - want.apr) <= 0.1,
    want.edge === null ? actual.edge === null : Math.abs(actual.edge - want.edge) <= 0.005
  ];
  const pass = checks.every(Boolean);
  failed = failed || !pass;
  const edge = actual.edge === null ? 'none' : actual.edge.toFixed(2);
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + scenario.id + ' final=' + actual.final + ' deadAt=' + (actual.deadAt === null ? 'never' : actual.deadAt) + ' apr=' + actual.apr.toFixed(1) + '% exiles=' + actual.exiles + ' wrong=' + actual.wrong + ' edge=' + edge);
}

process.exitCode = failed ? 1 : 0;
