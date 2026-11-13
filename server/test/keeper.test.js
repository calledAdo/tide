import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeeper } from '../src/keeper.js';

const config = { tideContract: 'tide.testnet', keeperEnabled: true, keeperIntervalMs: 30_000 };

function clock() {
  return new Date('2026-11-13T12:00:00.000Z');
}

test('keeper does nothing when the sea is synchronized', async () => {
  let sends = 0;
  const keeper = createKeeper({
    config,
    near: {
      async view() { return { seasons_behind: 0 }; },
      async send() { sends += 1; return 'never'; },
    },
    now: clock,
    logger: { info() {}, error() {} },
  });
  await keeper.run();
  assert.equal(sends, 0);
  assert.equal(keeper.state.lastError, null);
  assert.equal(keeper.state.lastTickHash, null);
});

test('keeper ticks at most five times per run while the sea is behind', async () => {
  let behind = 8;
  let sends = 0;
  const keeper = createKeeper({
    config,
    near: {
      async view() { return { seasons_behind: behind }; },
      async send() { sends += 1; behind -= 1; return { transaction: { hash: `tick-${sends}` } }; },
    },
    now: clock,
    logger: { info() {}, error() {} },
  });
  await keeper.run();
  assert.equal(sends, 5);
  assert.equal(behind, 3);
  assert.equal(keeper.state.lastTickHash, 'tick-5');
  assert.equal(keeper.state.lastError, null);
});
