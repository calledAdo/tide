import { createServer } from 'node:http';
import { yoctoToNear } from 'near-api-js';
import { loadConfig } from './config.js';
import { createKeeper } from './keeper.js';
import { createNear } from './near.js';
import { onboardAccount } from './onboard.js';
import { FileRateLimiter } from './ratelimit.js';
import { createIndexer } from './indexer.js';
import { createBots } from './bots.js';

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(payload);
}

function originHeaders(request, config) {
  const origin = request.headers.origin;
  if (!origin) return {};
  if (!config.frontendOrigins.includes(origin)) return { vary: 'Origin' };
  return {
    vary: 'Origin',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'Content-Type',
  };
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress ?? 'unknown';
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 2048) reject(Object.assign(new Error('Request body exceeds 2 KB.'), { status: 413 }));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function disabledIndexer() {
  return {
    status: () => ({ enabled: false, source: null, txsSeen: 0, processedHashes: 0, txsTotal: null, gap: null, lastPollAt: null, lastSweepAt: null, events: 0, lastError: null }),
    generations: () => [],
  };
}

function disabledBots() {
  return {
    status: () => ({ enabled: false, accounts: [], lastRunAt: null, stock: null, generation: null, phase: null, capacity: null, sustainable: null, floor: null, floorActive: false, seaLostForever: false }),
    summary: () => 'disabled; no bot captains configured',
  };
}

function queryLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

export function createHandler({ config, near, limiter, keeper, bots = disabledBots(), indexer = disabledIndexer(), now = () => Date.now() }) {
  return async (request, response) => {
    const cors = originHeaders(request, config);
    if (request.method === 'OPTIONS') {
      if (!request.headers.origin || config.frontendOrigins.includes(request.headers.origin)) {
        response.writeHead(204, cors);
        response.end();
      } else {
        sendJson(response, 403, { error: 'Origin is not allowed.' }, cors);
      }
      return;
    }

    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      let sponsorBalanceNear = null;
      let seasonsBehind = null;
      try { sponsorBalanceNear = yoctoToNear(await near.sponsorBalance()); } catch { /* health remains useful during RPC outage */ }
      try { seasonsBehind = Number((await near.view(config.tideContract, 'get_sea', {}))?.seasons_behind); } catch { /* health remains useful during RPC outage */ }
      const indexerStatus = indexer.status();
      sendJson(response, 200, {
        network: 'testnet',
        contract: config.tideContract,
        sponsor: config.sponsorAccountId,
        sponsorBalanceNear,
        seasonsBehind,
        keeperMinBehind: config.keeperMinBehind,
        keeper: keeper.state,
        bots: typeof bots.summary === 'function' ? bots.summary() : 'unknown',
        onboardedToday: await limiter.countToday(now()),
        gap: indexerStatus.gap,
        indexer: indexerStatus,
      }, cors);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/bots/status') {
      const status = bots.status();
      sendJson(response, 200, { ...status, bots: status.accounts }, { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/indexer/status') {
      sendJson(response, 200, indexer.status(), { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
      sendJson(response, 200, {
        events: indexer.events({
          limit: queryLimit(url.searchParams.get('limit'), 50, 200),
          before: Number.isSafeInteger(before) ? before : null,
          event: url.searchParams.get('event') || null,
          account: url.searchParams.get('account') || null,
        }),
      }, { ...cors, 'cache-control': 'no-store' });
      return;
    }
    const boatMatch = url.pathname.match(/^\/boat\/([^/]+)\/history$/);
    if (request.method === 'GET' && boatMatch) {
      let account;
      try { account = decodeURIComponent(boatMatch[1]); } catch { account = null; }
      if (!account) {
        sendJson(response, 400, { error: 'Invalid account.' }, { ...cors, 'cache-control': 'no-store' });
        return;
      }
      sendJson(response, 200, indexer.boatHistory(account), { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/assemblies') {
      sendJson(response, 200, indexer.assemblies(
        queryLimit(url.searchParams.get('limit'), 20, 100),
        url.searchParams.get('active') === 'true',
      ), { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/generations') {
      sendJson(response, 200, indexer.generations(
        queryLimit(url.searchParams.get('limit'), 20, 100),
      ), { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/leaderboard') {
      const by = url.searchParams.get('by') || 'catch';
      if (!['catch', 'net', 'indictments'].includes(by)) {
        sendJson(response, 400, { error: 'by must be catch, net, or indictments.' }, { ...cors, 'cache-control': 'no-store' });
        return;
      }
      sendJson(response, 200, indexer.leaderboard(by), { ...cors, 'cache-control': 'no-store' });
      return;
    }
    if (request.method !== 'POST' || url.pathname !== '/testnet/onboard') {
      sendJson(response, 404, { error: 'Not found.' }, cors);
      return;
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 404, { error: 'Not found.' }, cors);
      return;
    }

    let parsed;
    try {
      const raw = await readBody(request);
      parsed = JSON.parse(raw);
    } catch (error) {
      const status = error?.status ?? 400;
      sendJson(response, status, { error: status === 413 ? error.message : 'Request body must be valid JSON.' }, cors);
      return;
    }
    try {
      const result = await onboardAccount({ accountId: parsed?.accountId, clientIp: clientIp(request), config, near, limiter, now: now() });
      sendJson(response, result.status, result.body, { ...cors, 'cache-control': 'no-store' });
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error ? error.message : 'Testnet onboarding failed.' }, { ...cors, 'cache-control': 'no-store' });
    }
  };
}

export function buildService(config = loadConfig()) {
  const near = createNear(config);
  const limiter = new FileRateLimiter(config.dataDir);
  const keeper = createKeeper({ config, near });
  const bots = createBots({ config, near });
  const indexer = createIndexer({ config });
  return { config, near, limiter, keeper, bots, indexer, handler: createHandler({ config, near, limiter, keeper, bots, indexer }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const service = buildService();
  const server = createServer(service.handler);
  server.listen(service.config.port, service.config.host, () => {
    console.log(`tide server listening on ${service.config.host}:${service.config.port}`);
  });
  service.keeper.start();
  service.bots.start();
  service.indexer.start();
}
