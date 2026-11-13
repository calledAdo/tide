import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BOT_DEFINITIONS, createBots, effortForRole } from '../src/bots.js';

const config = (dataDir) => ({
  tideContract: 'tide.testnet',
  dataDir,
  botsEnabled: true,
  botsIntervalMs: 20_000,
});

function boat({ canFish = false } = {}) {
  return {
    can_fish_now: canFish,
    exiled_until: null,
    fair_share: '230',
    full_effort_catch: '1000',
  };
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'tide-bots-'));
}

test('effort maths follows each captain personality', () => {
  const view = boat();
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'honest'), 2300);
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'cautious'), 1840);
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'overfisher'), 10_000);
});

test('a bot fishes at most once per season and reads the sea once', async () => {
  const dataDir = await directory();
  const sends = [];
  let seaReads = 0;
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') { seaReads += 1; return { season: 4, seasons_behind: 0 }; }
      return boat({ canFish: true });
    },
    send: async (...args) => { sends.push(args); return `tx-${sends.length}`; },
  });
  await bots.run();
  await bots.run();
  assert.equal(seaReads, 2);
  assert.equal(sends.filter(([, method]) => method === 'fish').length, 6);
  assert.equal(sends.find(([account]) => account.startsWith('greedy-'))[2].effort_bps, 10_000);
});

test('honest captains vote yes only when the cycle has indictments', async () => {
  const votes = [];
  const runVotes = async (dataDir, indicted) => {
    const bots = createBots({
      config: config(dataDir),
      view: async (method) => {
        if (method === 'get_sea') return { season: 2, seasons_behind: 0 };
        if (method === 'get_boat') return boat();
        if (method === 'get_assembly') return { cycle: 0, stage: 'hold', eligible: 7, hold_yes: 0 };
        if (method === 'get_indictments') return indicted;
        throw new Error(`unexpected view ${method}`);
      },
      send: async (account, method, args) => { votes.push({ account, method, args }); return `vote-${votes.length}`; },
    });
    await bots.run();
  };
  await runVotes(await directory(), []);
  assert.equal(votes.every((vote) => vote.args.yes === false), true);
  await runVotes(await directory(), [['greedy-1794517191.memethis-t40-demo.testnet', '99']]);
  assert.equal(votes.filter((vote) => vote.args.yes === true).length, 5);
  assert.equal(votes.filter((vote) => vote.args.yes === false).length, 7);
});

test('shards require a passed hold and contain at most three indicted boats', async () => {
  const dataDir = await directory();
  const shards = [];
  const indicted = [
    ['one.testnet', '30'],
    ['two.testnet', '50'],
    ['three.testnet', '40'],
    ['four.testnet', '20'],
  ];
  let holdPassed = false;
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') return { season: 2, seasons_behind: 0 };
      if (method === 'get_boat') return boat();
      if (method === 'get_assembly') return { cycle: 0, stage: 'shards', eligible: 7, hold_yes: holdPassed ? 4 : 3 };
      if (method === 'get_indictments') return indicted;
      throw new Error(`unexpected view ${method}`);
    },
    send: async (account, method, args) => { if (method === 'write_shard') shards.push({ account, args }); return 'tx'; },
  });
  await bots.run();
  assert.equal(shards.length, 0);
  holdPassed = true;
  await bots.run();
  assert.equal(shards.length, 5);
  assert.deepEqual(shards[0].args.names, ['two.testnet', 'three.testnet', 'one.testnet']);
  assert.equal(shards.every(({ args }) => args.names.every((name) => indicted.some(([account]) => account === name))), true);
});

test('restart does not repeat a successful action', async () => {
  const dataDir = await directory();
  const sends = [];
  const makeBots = () => createBots({
    config: config(dataDir),
    view: async (method) => method === 'get_sea' ? { season: 4, seasons_behind: 0 } : boat({ canFish: true }),
    send: async (...args) => { sends.push(args); return 'tx'; },
  });
  await makeBots().run();
  await makeBots().run();
  assert.equal(sends.length, 6);
});

test('a contract panic for one bot does not stop the others', async () => {
  const dataDir = await directory();
  const successful = [];
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => method === 'get_sea' ? { season: 4, seasons_behind: 0 } : boat({ canFish: true }),
    send: async (account, method) => {
      if (account.startsWith('ana-')) throw new Error('panic: already fished');
      successful.push({ account, method });
      return 'tx';
    },
    logger: { error() {} },
  });
  await bots.run();
  assert.equal(successful.length, 5);
  assert.equal(bots.status().accounts.find((account) => account.account.startsWith('ana-')).lastError, 'panic: already fished');
  assert.equal(successful.every(({ method }) => method === 'fish'), true);
  assert.equal(BOT_DEFINITIONS.length, 6);
});
