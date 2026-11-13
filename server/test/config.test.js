import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

const required = {
  TIDE_CONTRACT: 'tide.testnet',
  SPONSOR_ACCOUNT_ID: 'sponsor.testnet',
  SPONSOR_PRIVATE_KEY: 'ed25519:placeholder',
  FRONTEND_ORIGINS: 'https://tide-near.vercel.app,http://localhost:5173',
};

test('loads defaults and parses onboarding values', () => {
  const config = loadConfig(required);
  assert.equal(config.port, 3101);
  assert.equal(config.keeperEnabled, true);
  assert.equal(config.keeperMinBehind, 30);
  assert.equal(config.fastNearTxUrl, 'https://tx.test.fastnear.com');
  assert.equal(config.indexerPollMs, 10000);
  assert.equal(config.onboardNearYocto, 500_000_000_000_000_000_000_000n);
  assert.deepEqual(config.frontendOrigins, ['https://tide-near.vercel.app', 'http://localhost:5173']);
});

test('fails fast when a required value is missing', () => {
  const missing = { ...required };
  delete missing.TIDE_CONTRACT;
  assert.throws(() => loadConfig(missing), /TIDE_CONTRACT/);
});
