import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BOT_DEFINITIONS,
  createBots,
  effortForRole,
  growthForStock,
} from '../src/bots.js';

const config = (dataDir) => ({
  tideContract: 'tide.testnet',
  dataDir,
  botsEnabled: true,
  botsIntervalMs: 20_000,
});

function boat({ canFish = false } = {}) {
  return {
    stake: '9900000000000000000000000',
    can_fish_now: canFish,
    exiled_until: null,
    fair_share: '230',
    full_effort_catch: '1000',
  };
}

function strategicBoat({ canFish = true, fairShare = '10000', fullCatch = '30000' } = {}) {
  return {
    stake: '9900000000000000000000000',
    can_fish_now: canFish,
    exiled_until: null,
    fair_share: fairShare,
    full_effort_catch: fullCatch,
  };
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'tide-bots-'));
}

test('effort maths follows each captain personality', () => {
  const view = boat();
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'honest'), 1380);
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'cautious'), 920);
  assert.equal(effortForRole({ ...view, fair_share: '230', full_effort_catch: '1000' }, 'overfisher'), 10_000);
});

test('growth follows the contract stock law', () => {
  assert.equal(growthForStock(689_000), 73_155);
});

test('a bot fishes at most once per season and reads the sea once', async () => {
  const dataDir = await directory();
  const sends = [];
  let seaReads = 0;
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') { seaReads += 1; return { season: 0, stock_fish: 700_000, seasons_behind: 0 }; }
      return boat({ canFish: true });
    },
    send: async (...args) => { sends.push(args); return `tx-${sends.length}`; },
  });
  await bots.run();
  await bots.run();
  assert.equal(seaReads, 2);
  assert.equal(sends.filter(([, method]) => method === 'fish').length, 6);
  assert.equal(sends.find(([account]) => account.startsWith('greedy-'))[2].effort_bps, 10_000);
  assert.equal(bots.status().stock, 700_000);
  assert.equal(bots.status().floorActive, false);
});

test('unstaked bots stake once and do not fish in the top-up season', async () => {
  const dataDir = await directory();
  const sends = [];
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') return { season: 1, stock_fish: 700_000, seasons_behind: 0 };
      return null;
    },
    send: async (...args) => { sends.push(args); return `tx-${sends.length}`; },
  });
  await bots.run();
  await bots.run();
  assert.equal(sends.length, BOT_DEFINITIONS.length);
  assert.equal(sends.every(([, method]) => method === 'stake'), true);
  assert.equal(sends.every(([, , args]) => args.amount === '9900000000000000000000000'), true);
});

test('fixed fractions fish fair share and greedy fishes only on even cycles', async () => {
  const dataDir = await directory();
  const fish = [];
  let season = 0;
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') return { season, stock_fish: 689_000, seasons_behind: 0 };
      return strategicBoat();
    },
    send: async (account, method, args) => {
      if (method === 'fish') fish.push({ account, args });
      return `tx-${fish.length}`;
    },
  });
  await bots.run();
  assert.equal(fish[0].account.startsWith('greedy-'), true);
  assert.equal(fish[0].args.effort_bps, 10_000);
  assert.equal(fish.length, 6);
  assert.equal(fish.find(({ account }) => account.startsWith('ana-')).args.effort_bps, 2_000);
  assert.equal(fish.find(({ account }) => account.startsWith('dee-')).args.effort_bps, 1_333);
  assert.equal(bots.status().accounts.find(({ account }) => account.startsWith('ana-')).targetFraction, 0.6);
  assert.equal(bots.status().accounts.find(({ account }) => account.startsWith('dee-')).targetFraction, 0.4);
  assert.equal(bots.status().accounts.find(({ account }) => account.startsWith('greedy-')).lastEffortBps, 10_000);

  fish.length = 0;
  season = 3;
  await bots.run();
  assert.equal(fish.length, 5);
  assert.equal(fish.some(({ account }) => account.startsWith('greedy-')), false);
});

test('the sea floor stops every bot until stock is above the recovery level', async () => {
  const dataDir = await directory();
  let stock = 399_999;
  const fish = [];
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => {
      if (method === 'get_sea') return { season: stock === 399_999 ? 0 : stock === 500_000 ? 3 : 6, stock_fish: stock, seasons_behind: 0 };
      return strategicBoat({ fullCatch: '3000' });
    },
    send: async (account, method, args) => { if (method === 'fish') fish.push({ account, args }); return 'tx'; },
  });
  await bots.run();
  assert.equal(fish.length, 0);
  assert.equal(bots.status().floorActive, true);
  stock = 500_000;
  await bots.run();
  assert.equal(fish.length, 0);
  stock = 500_001;
  await bots.run();
  assert.equal(fish.length, 6);
  assert.equal(bots.status().floorActive, false);
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
    view: async (method) => method === 'get_sea' ? { season: 0, stock_fish: 700_000, seasons_behind: 0 } : boat({ canFish: true }),
    send: async (...args) => { sends.push(args); return 'tx'; },
  });
  await makeBots().run();
  await makeBots().run();
  assert.equal(sends.length, 6);
});

test('restart does not re-stake or double-fish a strategic season', async () => {
  const dataDir = await directory();
  const sends = [];
  const makeBots = () => createBots({
    config: config(dataDir),
    view: async (method) => method === 'get_sea'
      ? { season: 0, stock_fish: 700_000, seasons_behind: 0 }
      : strategicBoat(),
    send: async (...args) => { sends.push(args); return 'tx'; },
  });
  await makeBots().run();
  await makeBots().run();
  assert.equal(sends.filter(([, method]) => method === 'stake').length, 0);
  assert.equal(sends.filter(([, method]) => method === 'fish').length, 6);
});

test('fixed bot rules keep a new sea above 600,000 for 500 seasons', () => {
  let stock = 700_000;
  const fullCatch = 28_708;
  const fairShare = 20_000;
  const boats = BOT_DEFINITIONS.map((definition) => ({
    ...definition,
    stake: 9_900_000,
    fair_share: fairShare,
    full_effort_catch: fullCatch,
  }));
  let floorActive = false;
  let minimum = stock;
  for (let season = 0; season < 500; season += 1) {
    const growth = growthForStock(stock);
    if (stock < 400_000) floorActive = true;
    else if (floorActive && stock > 500_000) floorActive = false;
    const cycle = Math.floor(season / 3);
    const caught = floorActive ? 0 : boats.reduce((total, boat) => {
      if (boat.role === 'overfisher' && cycle % 2 !== 0) return total;
      const effort = effortForRole(boat, boat.role);
      return total + Math.floor(boat.full_effort_catch * effort / 10_000);
    }, 0);
    stock = Math.max(0, stock + growth - caught);
    minimum = Math.min(minimum, stock);
  }
  assert.equal(minimum >= 600_000, true);
  assert.equal(stock > 0, true);
});

test('a contract panic for one bot does not stop the others', async () => {
  const dataDir = await directory();
  const successful = [];
  const bots = createBots({
    config: config(dataDir),
    view: async (method) => method === 'get_sea'
      ? { season: 0, stock_fish: 700_000, seasons_behind: 0 }
      : boat({ canFish: true }),
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
