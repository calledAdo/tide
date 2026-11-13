import { createServer } from 'node:http';
import { yoctoToNear } from 'near-api-js';
import { loadConfig } from './config.js';
import { createKeeper } from './keeper.js';
import { createNear } from './near.js';
import { onboardAccount } from './onboard.js';
import { FileRateLimiter } from './ratelimit.js';

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

export function createHandler({ config, near, limiter, keeper, now = () => Date.now() }) {
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

    if (request.url !== '/health' && request.url !== '/testnet/onboard') {
      sendJson(response, 404, { error: 'Not found.' }, cors);
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      let sponsorBalanceNear = null;
      let seasonsBehind = null;
      try { sponsorBalanceNear = yoctoToNear(await near.sponsorBalance()); } catch { /* health remains useful during RPC outage */ }
      try { seasonsBehind = Number((await near.view(config.tideContract, 'get_sea', {}))?.seasons_behind); } catch { /* health remains useful during RPC outage */ }
      sendJson(response, 200, {
        network: 'testnet',
        contract: config.tideContract,
        sponsor: config.sponsorAccountId,
        sponsorBalanceNear,
        seasonsBehind,
        keeper: keeper.state,
        onboardedToday: await limiter.countToday(now()),
      }, cors);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/testnet/onboard') {
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
  return { config, near, limiter, keeper, handler: createHandler({ config, near, limiter, keeper }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const service = buildService();
  const server = createServer(service.handler);
  server.listen(service.config.port, service.config.host, () => {
    console.log(`tide server listening on ${service.config.host}:${service.config.port}`);
  });
  service.keeper.start();
}
