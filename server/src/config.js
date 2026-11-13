import { nearToYocto } from 'near-api-js';

const DEFAULTS = {
  PORT: '3101',
  HOST: '127.0.0.1',
  RPC_URL: 'https://test.rpc.fastnear.com',
  DATA_DIR: '/var/lib/tide',
  ONBOARD_NEAR: '0.5',
  ONBOARD_MIN_NEAR: '0.1',
  ONBOARD_DAILY_CAP: '60',
  KEEPER_INTERVAL_MS: '30000',
  KEEPER_MIN_BEHIND: '30',
  KEEPER_ENABLED: 'true',
  BOTS_ENABLED: 'true',
  BOTS_INTERVAL_MS: '20000',
  BOT_KEYS_FILE: '/etc/tide/bot-keys.json',
  INDEXER_ENABLED: 'true',
  FASTNEAR_TX_URL: 'https://tx.test.fastnear.com',
  INDEXER_POLL_MS: '10000',
  INDEXER_SWEEP_MS: '300000',
};

function value(env, name) {
  return env[name] ?? DEFAULTS[name];
}

function required(env, name) {
  const result = env[name]?.trim();
  if (!result) throw new Error(`Missing required environment variable: ${name}`);
  return result;
}

function positiveInteger(raw, name) {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer.`);
  return result;
}

function nonNegativeInteger(raw, name) {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer.`);
  const result = Number(raw);
  if (!Number.isSafeInteger(result)) throw new Error(`${name} is too large.`);
  return result;
}

function booleanValue(raw, name) {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false.`);
}

function nearAmount(raw, name) {
  try {
    const yocto = nearToYocto(raw);
    if (yocto < 0n) throw new Error();
    return { display: raw, yocto };
  } catch {
    throw new Error(`${name} must be a valid non-negative NEAR amount.`);
  }
}

export function loadConfig(env = process.env) {
  const origins = required(env, 'FRONTEND_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) throw new Error('FRONTEND_ORIGINS must contain at least one origin.');

  const onboardNear = nearAmount(value(env, 'ONBOARD_NEAR'), 'ONBOARD_NEAR');
  const onboardMinNear = nearAmount(value(env, 'ONBOARD_MIN_NEAR'), 'ONBOARD_MIN_NEAR');
  if (onboardNear.yocto < onboardMinNear.yocto) {
    throw new Error('ONBOARD_NEAR must be greater than or equal to ONBOARD_MIN_NEAR.');
  }

  return {
    port: positiveInteger(value(env, 'PORT'), 'PORT'),
    host: value(env, 'HOST'),
    rpcUrl: value(env, 'RPC_URL'),
    tideContract: required(env, 'TIDE_CONTRACT'),
    sponsorAccountId: required(env, 'SPONSOR_ACCOUNT_ID'),
    sponsorPrivateKey: required(env, 'SPONSOR_PRIVATE_KEY'),
    frontendOrigins: origins,
    dataDir: value(env, 'DATA_DIR'),
    onboardNear: onboardNear.display,
    onboardNearYocto: onboardNear.yocto,
    onboardMinNear: onboardMinNear.display,
    onboardMinNearYocto: onboardMinNear.yocto,
    onboardDailyCap: positiveInteger(value(env, 'ONBOARD_DAILY_CAP'), 'ONBOARD_DAILY_CAP'),
    keeperIntervalMs: positiveInteger(value(env, 'KEEPER_INTERVAL_MS'), 'KEEPER_INTERVAL_MS'),
    keeperMinBehind: nonNegativeInteger(value(env, 'KEEPER_MIN_BEHIND'), 'KEEPER_MIN_BEHIND'),
    keeperEnabled: booleanValue(value(env, 'KEEPER_ENABLED'), 'KEEPER_ENABLED'),
    botsEnabled: booleanValue(value(env, 'BOTS_ENABLED'), 'BOTS_ENABLED'),
    botsIntervalMs: positiveInteger(value(env, 'BOTS_INTERVAL_MS'), 'BOTS_INTERVAL_MS'),
    botKeysFile: value(env, 'BOT_KEYS_FILE'),
    indexerEnabled: booleanValue(value(env, 'INDEXER_ENABLED'), 'INDEXER_ENABLED'),
    fastNearTxUrl: value(env, 'FASTNEAR_TX_URL').replace(/\/$/, ''),
    indexerPollMs: positiveInteger(value(env, 'INDEXER_POLL_MS'), 'INDEXER_POLL_MS'),
    indexerSweepMs: positiveInteger(value(env, 'INDEXER_SWEEP_MS'), 'INDEXER_SWEEP_MS'),
    sponsorMinimumYocto: nearToYocto('1'),
  };
}

export { nonNegativeInteger };
