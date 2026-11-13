import { actions, TGAS } from './near.js';

export const ETH_IMPLICIT_PATTERN = /^0x[a-f0-9]{40}$/;
const SPONSOR_MINIMUM_YOCTO = 1_000_000_000_000_000_000_000_000n;

function validBalance(value) {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export async function onboardAccount({ accountId, clientIp, config, near, limiter, now = Date.now() }) {
  if (typeof accountId !== 'string' || !ETH_IMPLICIT_PATTERN.test(accountId)) {
    return { status: 400, body: { error: 'Only lowercase eth-implicit accounts are supported.' } };
  }

  const [balance, registered] = await Promise.all([
    near.balance(accountId),
    near.view(config.tideContract, 'storage_balance_of', { account_id: accountId }),
  ]);
  const nearBalance = validBalance(balance);
  if (nearBalance >= config.onboardMinNearYocto && registered) {
    return { status: 200, body: { funded: false, reason: 'Account already has enough NEAR and is registered.' } };
  }

  const sponsorBalance = validBalance(await near.sponsorBalance());
  if (sponsorBalance < (config.sponsorMinimumYocto ?? SPONSOR_MINIMUM_YOCTO)) {
    return { status: 503, body: { error: 'Onboarding sponsor balance is below 1 NEAR.' } };
  }

  const limit = await limiter.consume({ accountId, ip: clientIp, dailyCap: config.onboardDailyCap, now });
  if (!limit.allowed) return { status: 429, body: { error: limit.reason } };

  const transactions = [];
  try {
    if (nearBalance < config.onboardMinNearYocto) {
      const amount = config.onboardNearYocto - nearBalance;
      if (amount <= 0n) throw new Error('ONBOARD_NEAR must exceed the account balance when funding.');
      transactions.push(await near.send(accountId, [actions.transfer(amount)]));
    }

    if (!registered) {
      const bounds = await near.view(config.tideContract, 'storage_balance_bounds', {});
      if (!bounds || !/^\d+$/.test(String(bounds.min))) throw new Error('TIDE returned invalid storage balance bounds.');
      transactions.push(await near.send(config.tideContract, [actions.functionCall(
        'storage_deposit',
        { account_id: accountId, registration_only: true },
        100n * TGAS,
        BigInt(bounds.min),
      )]));
    }
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : 'Testnet onboarding failed.' } };
  }

  return {
    status: 200,
    body: { funded: true, accountId, near: config.onboardNear, registered: true, transactions },
  };
}
