import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../src/index.js';

function response() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = JSON.parse(payload); },
  };
}

test('/assemblies forwards active and applies the query limit', async () => {
  const calls = [];
  const handler = createHandler({
    config: { frontendOrigins: [] },
    near: {},
    limiter: {},
    keeper: {},
    indexer: {
      assemblies(limit, active) {
        calls.push({ limit, active });
        return [];
      },
    },
  });

  const filteredResponse = response();
  await handler({ method: 'GET', url: '/assemblies?active=true&limit=50', headers: {} }, filteredResponse);
  const allResponse = response();
  await handler({ method: 'GET', url: '/assemblies?limit=50', headers: {} }, allResponse);

  assert.equal(filteredResponse.status, 200);
  assert.deepEqual(filteredResponse.body, []);
  assert.deepEqual(calls, [{ limit: 50, active: true }, { limit: 50, active: false }]);
});

test('/bots/status returns the bot status without caching', async () => {
  const handler = createHandler({
    config: { frontendOrigins: [] },
    near: {},
    limiter: {},
    keeper: {},
    bots: { status: () => ({ enabled: true, accounts: [], lastRunAt: null, stock: null, floorActive: false }), summary: () => 'enabled' },
  });
  const result = response();
  await handler({ method: 'GET', url: '/bots/status', headers: {} }, result);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { enabled: true, accounts: [], bots: [], lastRunAt: null, stock: null, floorActive: false });
});

test('/health exposes the indexer gap', async () => {
  const handler = createHandler({
    config: { frontendOrigins: [], tideContract: 'tide.testnet', sponsorAccountId: 'sponsor.testnet', keeperMinBehind: 30 },
    near: {
      sponsorBalance: async () => '0',
      view: async () => ({ seasons_behind: 0 }),
    },
    limiter: { countToday: async () => 0 },
    keeper: { state: {} },
    indexer: { status: () => ({ gap: 3, processedHashes: 10, txsTotal: 13 }) },
  });
  const result = response();

  await handler({ method: 'GET', url: '/health', headers: {} }, result);

  assert.equal(result.status, 200);
  assert.equal(result.body.gap, 3);
  assert.equal(result.body.indexer.gap, 3);
});
