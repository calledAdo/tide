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
