import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDerivedIndexes, createIndexer, parseEvents } from '../src/indexer.js';

const CONTRACT = 'tide-1794517191.memethis-t40-demo.testnet';

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

async function fixture(name) {
  return JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', name), 'utf8'));
}

test('parseEvents reads the real transaction and filters receipts by executor and status', async () => {
  const account = await fixture('real-account-txs.json');
  const result = await fixture('real-transactions-fish.json');
  const accountTx = account.account_txs.find((entry) => entry.transaction_hash === result.transactions[0].transaction.hash);
  const events = parseEvents(result.transactions[0], CONTRACT, accountTx);
  const catchEvent = events.find((event) => event.event === 'catch');

  assert.equal(events.length, 57);
  assert.deepEqual(catchEvent, {
    height: 277426443,
    ts: 1794523572521,
    tx: '6GdBagBmp2Ux58RLfhk4PjVW1bBQgogQG4QuF9X2mHH7',
    tx_hash: '6GdBagBmp2Ux58RLfhk4PjVW1bBQgogQG4QuF9X2mHH7',
    receipt_id: 'EcnyB6MgDM18C6XbR3HC2NrHSUiuH5ewqvxV5zRbjMMC',
    log_index: 56,
    data_index: 0,
    standard: 'tide',
    event: 'catch',
    data: {
      account: 'eve-1794517191.memethis-t40-demo.testnet',
      season: 61,
      effort_bps: 2300,
      catch: '9583333333304583333333',
      fuel: '4554000000000000000000',
      fair_share: '9754000000000000000000',
    },
  });
  assert.ok(events.every((event) => event.height === 277426443 && event.ts === 1794523572521));
});

test('account paging uses the lowest height and stops after a short page', async () => {
  const account = await fixture('real-account-txs.json');
  const oldEntry = { ...account.account_txs.at(-1), transaction_hash: 'old-hash', tx_block_height: account.account_txs.at(-1).tx_block_height - 1 };
  const calls = [];
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  try {
    const indexer = createIndexer({
      config: { dataDir, tideContract: CONTRACT },
      fetchFn: async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ path: new URL(url).pathname, body });
        if (body.max_block_height === undefined) return response({ txs_count: 151, account_txs: account.account_txs });
        if (body.max_block_height === account.account_txs.at(-1).tx_block_height - 1) return response({ txs_count: 151, account_txs: [oldEntry] });
        assert.fail(`unexpected page height ${body.max_block_height}`);
      },
      sleep: async () => {},
    });
    await indexer.syncOnce();
    const accountCalls = calls.filter((call) => call.path === '/v0/account');
    assert.equal(accountCalls.length, 2);
    assert.equal(accountCalls[1].body.max_block_height, 277415609);
    assert.equal(indexer.status().txsTotal, 151);
    assert.equal(indexer.status().txsSeen, 151);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a known first hash does not hide an unknown older hash on the same page', async () => {
  const known = { transaction_hash: 'known-hash', tx_block_height: 20, tx_block_timestamp: '20' };
  const unknown = { transaction_hash: 'unknown-hash', tx_block_height: 10, tx_block_timestamp: '10' };
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  try {
    let accountCalls = 0;
    const transactionBatches = [];
    const indexer = createIndexer({
      config: { dataDir, tideContract: CONTRACT },
      fetchFn: async (url, options) => {
        if (url.endsWith('/v0/account')) {
          accountCalls += 1;
          return response(accountCalls === 1
            ? { txs_count: 1, account_txs: [known] }
            : { txs_count: 2, account_txs: [known, unknown] });
        }
        transactionBatches.push(JSON.parse(options.body).tx_hashes);
        return response({ transactions: [] });
      },
      sleep: async () => {},
    });

    await indexer.syncOnce();
    await indexer.syncOnce();

    assert.deepEqual(transactionBatches, [['known-hash'], ['unknown-hash']]);
    assert.equal(indexer.status().processedHashes, 2);
    assert.equal(indexer.status().gap, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a head shift is recovered by the next full sweep', async () => {
  const initial = Array.from({ length: 150 }, (_, index) => ({
    transaction_hash: `hash-${index}`,
    tx_block_height: 150 - index,
    tx_block_timestamp: String(150 - index),
  }));
  const newHead = { transaction_hash: 'new-head', tx_block_height: 151, tx_block_timestamp: '151' };
  const missed = { transaction_hash: 'missed', tx_block_height: 0, tx_block_timestamp: '0' };
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  let accountCalls = 0;
  try {
    const transactionBatches = [];
    const indexer = createIndexer({
      config: { dataDir, tideContract: CONTRACT, indexerSweepMs: 300_000 },
      fetchFn: async (url, options) => {
        if (url.endsWith('/v0/account')) {
          accountCalls += 1;
          if (accountCalls === 1) return response({ txs_count: 150, account_txs: initial });
          if (accountCalls === 2) return response({ txs_count: 150, account_txs: [] });
          if (accountCalls === 3) return response({ txs_count: 152, account_txs: [newHead, ...initial.slice(0, 149)] });
          if (accountCalls === 4) return response({ txs_count: 152, account_txs: [initial[149]] });
          if (accountCalls === 5) return response({ txs_count: 152, account_txs: [newHead, ...initial.slice(0, 149)] });
          if (accountCalls === 6) return response({ txs_count: 152, account_txs: [initial[149], missed] });
          assert.fail(`unexpected account call ${accountCalls}`);
        }
        transactionBatches.push(JSON.parse(options.body).tx_hashes);
        return response({ transactions: [] });
      },
      sleep: async () => {},
    });

    await indexer.syncOnce();
    await indexer.syncOnce();
    assert.equal(indexer.status().gap, 1);
    await indexer.syncOnce();

    assert.equal(indexer.status().processedHashes, 152);
    assert.equal(indexer.status().gap, 0);
    assert.ok(transactionBatches.flat().includes('missed'));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('re-processing a hash is idempotent and restart resumes from indexed-txs.json', async () => {
  const account = await fixture('real-account-txs.json');
  const result = await fixture('real-transactions-fish.json');
  const accountTx = account.account_txs.find((entry) => entry.transaction_hash === result.transactions[0].transaction.hash);
  const page = { txs_count: 1, account_txs: [accountTx] };
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  try {
    let transactionCalls = 0;
    const fetchFn = async (url) => {
      if (url.endsWith('/v0/account')) return response(page);
      transactionCalls += 1;
      return response(result);
    };
    const first = createIndexer({ config: { dataDir, tideContract: CONTRACT }, fetchFn, sleep: async () => {} });
    await first.syncOnce();
    assert.equal(first.status().txsSeen, 1);
    assert.equal(first.status().events, 57);
    await first.syncOnce();
    assert.equal(transactionCalls, 1);
    assert.equal(first.status().events, 57);

    const resumed = createIndexer({ config: { dataDir, tideContract: CONTRACT }, fetchFn, sleep: async () => {} });
    await resumed.syncOnce();
    assert.equal(transactionCalls, 1);
    assert.equal(resumed.status().txsSeen, 1);
    assert.equal(resumed.status().events, 57);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'indexed-txs.json'), 'utf8')), [accountTx.transaction_hash]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a scheduled sweep re-processes transactions without duplicating events', async () => {
  const account = await fixture('real-account-txs.json');
  const result = await fixture('real-transactions-fish.json');
  const accountTx = account.account_txs.find((entry) => entry.transaction_hash === result.transactions[0].transaction.hash);
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  const eventsPath = join(dataDir, 'events.jsonl');
  let currentTime = 1_000_000;
  let transactionCalls = 0;
  try {
    const indexer = createIndexer({
      config: { dataDir, tideContract: CONTRACT, indexerSweepMs: 100 },
      now: () => currentTime,
      fetchFn: async (url) => {
        if (url.endsWith('/v0/account')) return response({ txs_count: 1, account_txs: [accountTx] });
        transactionCalls += 1;
        return response(result);
      },
      sleep: async () => {},
    });

    await indexer.syncOnce();
    currentTime += 101;
    await indexer.syncOnce();

    assert.equal(transactionCalls, 2);
    assert.equal(indexer.status().events, 57);
    assert.equal((await readFile(eventsPath, 'utf8')).trim().split('\n').length, 57);
    assert.equal(indexer.status().gap, 0);
    assert.ok(indexer.status().lastSweepAt);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('dedupes repeated transactions, event identities, and persisted event lines', async () => {
  const account = await fixture('real-account-txs.json');
  const result = await fixture('real-transactions-fish.json');
  const accountTx = account.account_txs.find((entry) => entry.transaction_hash === result.transactions[0].transaction.hash);
  const page = { txs_count: 2, account_txs: [accountTx, { ...accountTx }] };
  const transaction = result.transactions[0];
  const duplicateReceiptResult = {
    ...result,
    transactions: [{ ...transaction, receipts: [...transaction.receipts, transaction.receipts[0]] }],
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  const eventsPath = join(dataDir, 'events.jsonl');
  try {
    let transactionCalls = 0;
    const fetchFn = async (url, options) => {
      if (url.endsWith('/v0/account')) return response(page);
      transactionCalls += 1;
      assert.deepEqual(JSON.parse(options.body).tx_hashes, [accountTx.transaction_hash]);
      return response(duplicateReceiptResult);
    };
    const first = createIndexer({ config: { dataDir, tideContract: CONTRACT }, fetchFn, sleep: async () => {} });
    await first.syncOnce();
    await first.syncOnce();
    assert.equal(transactionCalls, 1);
    assert.equal(first.status().events, 57);

    const persisted = await readFile(eventsPath, 'utf8');
    await appendFile(eventsPath, persisted);
    const resumed = createIndexer({ config: { dataDir, tideContract: CONTRACT }, fetchFn, sleep: async () => {} });
    await resumed.initialize();
    assert.equal(resumed.status().events, 57);
    assert.equal((await readFile(eventsPath, 'utf8')).trim().split('\n').length, 57);

    const indexes = createDerivedIndexes();
    const events = parseEvents(result.transactions[0], CONTRACT, accountTx);
    for (const event of [...events, ...events]) indexes.add(event);
    assert.equal(indexes.count(), events.length);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('dedupes the same account transaction at different heights using the lowest height', async () => {
  const account = await fixture('real-account-txs.json');
  const result = await fixture('real-transactions-fish.json');
  const accountTx = account.account_txs.find((entry) => entry.transaction_hash === result.transactions[0].transaction.hash);
  const lower = { ...accountTx, tx_block_height: accountTx.tx_block_height - 1 };
  const higher = { ...accountTx, tx_block_height: accountTx.tx_block_height };
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  try {
    let transactionCalls = 0;
    const indexer = createIndexer({
      config: { dataDir, tideContract: CONTRACT },
      fetchFn: async (url, options) => {
        if (url.endsWith('/v0/account')) return response({ txs_count: 2, account_txs: [higher, lower] });
        transactionCalls += 1;
        assert.deepEqual(JSON.parse(options.body).tx_hashes, [accountTx.transaction_hash]);
        return response(result);
      },
      sleep: async () => {},
    });

    await indexer.syncOnce();

    assert.equal(transactionCalls, 1);
    assert.equal(indexer.status().events, 57);
    assert.equal(indexer.events({ event: 'catch', limit: 1 })[0].height, lower.tx_block_height);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('rebuild dedupes legacy event lines without receipt coordinates', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-indexer-'));
  const eventsPath = join(dataDir, 'events.jsonl');
  const event = {
    tx: 'legacy-tx',
    standard: 'tide',
    event: 'catch',
    data: { account: 'alice.testnet', catch: '10' },
  };
  try {
    await writeFile(eventsPath, `${JSON.stringify({ ...event, height: 20, ts: 200 })}\n${JSON.stringify({ ...event, height: 10, ts: 100 })}\n`);
    const indexer = createIndexer({ config: { dataDir, tideContract: CONTRACT } });

    await indexer.initialize();

    assert.equal(indexer.status().events, 1);
    assert.equal(JSON.parse((await readFile(eventsPath, 'utf8')).trim()).height, 10);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('history totals and assembly aggregation are derived from event records', () => {
  const indexes = createDerivedIndexes();
  const add = (height, event, data, standard = 'tide') => indexes.add({ height, ts: height * 1000, tx: `tx-${height}`, standard, event, data });
  add(1, 'boat_staked', { account: 'alice.testnet', stake: '100', burned: '1' });
  add(2, 'ft_burn', { owner_id: 'alice.testnet', amount: '30', memo: 'fuel' }, 'nep141');
  add(2, 'catch', { account: 'alice.testnet', season: 2, effort_bps: 5000, catch: '100', fuel: '30', fair_share: '80' });
  add(3, 'indicted', { account: 'alice.testnet', season: 2, cycle: 0, over_share: '20' });
  add(4, 'hold_vote', { account: 'alice.testnet', cycle: 0, yes: true });
  add(5, 'hold_vote', { account: 'bob.testnet', cycle: 0, yes: false });
  add(6, 'shard', { account: 'alice.testnet', cycle: 0, names: ['bob.testnet', 'carol.testnet'] });
  add(7, 'exiled', { account: 'carol.testnet', cycle: 0, until_season: 11 });
  add(8, 'assembly_closed', { cycle: 0, held: true, hold_yes: 1, hold_no: 1, eligible: 2, exiled: ['carol.testnet'] });

  const history = indexes.boatHistory('alice.testnet');
  assert.deepEqual(history.totals, { catch: '100', fuel: '30', net: '70', trips: 1, indictments: 1, overageTotal: '20', exiles: 0, votesYes: 1, votesNo: 0, shardsWritten: 1 });
  assert.deepEqual(history.trips[0], { season: 2, catch: '100', fuel: '30', fairShare: '80', effortBps: 5000, tx: 'tx-2', ts: 2000 });
  assert.deepEqual(indexes.assemblies(), [{ cycle: 0, held: true, holdYes: 1, holdNo: 1, eligible: 2, shards: { 'bob.testnet': 1, 'carol.testnet': 1 }, exiled: ['carol.testnet'], closedAt: { height: 8, ts: 8000, tx: 'tx-8' } }]);
});

test('active assembly history filters before applying the limit', () => {
  const indexes = createDerivedIndexes();
  const add = (height, event, data) => indexes.add({ height, ts: height * 1000, tx: `tx-${height}`, standard: 'tide', event, data });
  add(1, 'assembly_closed', { cycle: 1, held: false, hold_yes: 0, hold_no: 0, eligible: 2, exiled: [] });
  add(2, 'hold_vote', { cycle: 2, yes: true });
  add(3, 'assembly_closed', { cycle: 3, held: false, hold_yes: 0, hold_no: 0, eligible: 2, exiled: [] });
  add(4, 'shard', { cycle: 4, names: ['alice.testnet'] });
  add(5, 'exiled', { cycle: 5, account: 'bob.testnet' });

  assert.deepEqual(indexes.assemblies(2, true).map((assembly) => assembly.cycle), [5, 4]);
  assert.deepEqual(indexes.assemblies(10, true).map((assembly) => assembly.cycle), [5, 4, 2]);
});

test('generation history aggregates reckoning, wrecks, reseeding, and contributors', () => {
  const indexes = createDerivedIndexes();
  const add = (height, event, data) => indexes.add({ height, ts: height * 1000, tx: `tx-${height}`, standard: 'tide', event, data });
  add(1, 'reckoning', { generation: 1, season: 42, boats_wrecked: 2, burned_total: '900' });
  add(2, 'boat_wrecked', { account: 'alice.testnet', burned: '400' });
  add(3, 'boat_wrecked', { account: 'bob.testnet', burned: '500' });
  add(4, 'reseed_contribution', { account: 'alice.testnet', amount: '150' });
  add(5, 'reseed_contribution', { account: 'bob.testnet', amount: '150' });
  add(6, 'reseeded', { generation: 1, season: 43, funded: true });

  assert.deepEqual(indexes.generations(), [{
    generation: 1,
    diedSeason: 42,
    boatsWrecked: 2,
    burnedTotal: '900',
    reseededSeason: 43,
    funded: true,
    contributors: [['alice.testnet', '150'], ['bob.testnet', '150']],
  }]);
});
