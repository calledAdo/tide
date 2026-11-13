import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeeper } from '../src/keeper.js';

const config = { tideContract: 'tide.testnet', keeperEnabled: true, keeperIntervalMs: 30_000, keeperMinBehind: 30 };

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

test('keeper does not tick at the minimum threshold', async () => {
  let behind = 30;
  let sends = 0;
  const keeper = createKeeper({
    config,
    near: {
      async view() { return { seasons_behind: behind }; },
      async send() { sends += 1; return 'never'; },
    },
    now: clock,
    logger: { info() {}, error() {} },
  });
  await keeper.run();
  assert.equal(sends, 0);
  assert.equal(behind, 30);
  assert.equal(keeper.state.lastTickHash, null);
  assert.equal(keeper.state.lastError, null);
});

test('keeper ticks above the minimum threshold until it is reached', async () => {
  let behind = 31;
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
  assert.equal(sends, 1);
  assert.equal(behind, 30);
  assert.equal(keeper.state.lastTickHash, 'tick-1');
  assert.equal(keeper.state.lastError, null);
});

test('keeper still caps a run at five ticks', async () => {
  let behind = 40;
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
  assert.equal(behind, 35);
  assert.equal(keeper.state.lastTickHash, 'tick-5');
  assert.equal(keeper.state.lastError, null);
});
