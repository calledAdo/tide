import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileRateLimiter } from '../src/ratelimit.js';
import { onboardAccount } from '../src/onboard.js';

const MIN = 100_000_000_000_000_000_000_000n;
const TARGET = 500_000_000_000_000_000_000_000n;
const SPONSOR_OK = 2_000_000_000_000_000_000_000_000n;
const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function config(dataDir, dailyCap = 60) {
  return {
    tideContract: 'tide.testnet',
    sponsorAccountId: 'sponsor.testnet',
    onboardNear: '0.5',
    onboardNearYocto: TARGET,
    onboardMinNearYocto: MIN,
    onboardDailyCap: dailyCap,
    sponsorMinimumYocto: 1_000_000_000_000_000_000_000_000n,
    dataDir,
  };
}

function fakeNear({ balance = 0n, registered = null, sponsorBalance = SPONSOR_OK } = {}) {
  const sends = [];
  return {
    sends,
    async balance() { return balance; },
    async sponsorBalance() { return sponsorBalance; },
    async view(_contract, method) {
      if (method === 'storage_balance_of') return registered;
      if (method === 'storage_balance_bounds') return { min: '1250000000000000000000' };
      throw new Error(`unexpected view ${method}`);
    },
    async send(receiverId, actions) {
      sends.push({ receiverId, actions });
      return `hash-${sends.length}`;
    },
  };
}

async function tempLimiter() {
  const dataDir = await mkdtemp(join(tmpdir(), 'tide-onboard-'));
  return { dataDir, limiter: new FileRateLimiter(dataDir) };
}

test('rejects invalid eth-implicit account IDs with 400', async () => {
  const { dataDir, limiter } = await tempLimiter();
  try {
    const result = await onboardAccount({ accountId: '0xABC', config: config(dataDir), near: fakeNear(), limiter, clientIp: '127.0.0.1' });
    assert.equal(result.status, 400);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('returns the already-funded path without sending transactions', async () => {
  const { dataDir, limiter } = await tempLimiter();
  const near = fakeNear({ balance: TARGET, registered: { total: '1' } });
  try {
    const result = await onboardAccount({ accountId: ACCOUNT, config: config(dataDir), near, limiter, clientIp: '127.0.0.1' });
    assert.deepEqual(result, { status: 200, body: { funded: false, reason: 'Account already has enough NEAR and is registered.' } });
    assert.equal(near.sends.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('funds and registers an account with mocked transactions', async () => {
  const { dataDir, limiter } = await tempLimiter();
  const near = fakeNear();
  try {
    const result = await onboardAccount({ accountId: ACCOUNT, config: config(dataDir), near, limiter, clientIp: '127.0.0.1' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.transactions, ['hash-1', 'hash-2']);
    assert.equal(near.sends[0].receiverId, ACCOUNT);
    assert.equal(near.sends[1].receiverId, 'tide.testnet');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('enforces account, IP, and daily limits and persists them', async () => {
  const { dataDir, limiter } = await tempLimiter();
  const cfg = config(dataDir, 6);
  const now = 1_700_000_000_000;
  try {
    const first = await onboardAccount({ accountId: ACCOUNT, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.1', now });
    assert.equal(first.status, 200);
    const restored = new FileRateLimiter(dataDir);
    const persisted = await onboardAccount({ accountId: ACCOUNT, config: cfg, near: fakeNear(), limiter: restored, clientIp: '10.0.0.2', now });
    assert.equal(persisted.status, 429);
    assert.match(persisted.body.error, /account/i);

    for (let i = 1; i <= 5; i += 1) {
      const result = await onboardAccount({
        accountId: `0x${String(i).padStart(40, 'b')}`,
        config: cfg,
        near: fakeNear(),
        limiter,
        clientIp: '10.0.0.3',
        now,
      });
      assert.equal(result.status, 200);
    }
    const sixthIp = await onboardAccount({ accountId: `0x${'c'.repeat(40)}`, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.3', now });
    assert.equal(sixthIp.status, 429);
    assert.match(sixthIp.body.error, /IP/i);

    const daily = await onboardAccount({ accountId: `0x${'d'.repeat(40)}`, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.4', now });
    assert.equal(daily.status, 429);
    assert.match(daily.body.error, /daily/i);

    const persistedDaily = await onboardAccount({ accountId: `0x${'e'.repeat(40)}`, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.5', now });
    assert.equal(persistedDaily.status, 429);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('keeps account and IP cooldowns across UTC midnight', async () => {
  const { dataDir, limiter } = await tempLimiter();
  const cfg = config(dataDir);
  const beforeMidnight = Date.parse('2026-11-13T23:59:00.000Z');
  try {
    const first = await onboardAccount({ accountId: ACCOUNT, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.9', now: beforeMidnight });
    assert.equal(first.status, 200);
    const nextDay = await onboardAccount({ accountId: ACCOUNT, config: cfg, near: fakeNear(), limiter, clientIp: '10.0.0.9', now: Date.parse('2026-11-14T00:01:00.000Z') });
    assert.equal(nextDay.status, 429);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('refuses onboarding when the sponsor has less than 1 NEAR', async () => {
  const { dataDir, limiter } = await tempLimiter();
  try {
    const near = fakeNear({ sponsorBalance: SPONSOR_OK / 4n });
    const result = await onboardAccount({ accountId: ACCOUNT, config: config(dataDir), near, limiter, clientIp: '127.0.0.1' });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /below 1 NEAR/);
    assert.equal(near.sends.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
