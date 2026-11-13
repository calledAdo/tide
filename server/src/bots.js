import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actions } from './near.js';

const BOT_ACCOUNTS = [
  ['ana-1794517191.memethis-t40-demo.testnet', 'honest'],
  ['ben-1794517191.memethis-t40-demo.testnet', 'honest'],
  ['cy-1794517191.memethis-t40-demo.testnet', 'honest'],
  ['dee-1794517191.memethis-t40-demo.testnet', 'cautious'],
  ['eve-1794517191.memethis-t40-demo.testnet', 'honest'],
  ['greedy-1794517191.memethis-t40-demo.testnet', 'overfisher'],
];

const BOT_DEFINITIONS = BOT_ACCOUNTS.map(([account, role]) => ({ account, role }));
const BOT_GAS = 30n * 1_000_000_000_000n;
const BOT_STAKE_AMOUNT = 9_900_000n * 10n ** 18n;
const FLOOR_TRIGGER_STOCK = 400_000;
const FLOOR_RECOVERY_STOCK = 500_000;
const STOCK_CAP = 1_000_000;
const TARGET_FRACTION_BPS = Object.freeze({ honest: 6_000, cautious: 4_000, overfisher: 10_000 });

function newAccountState(definition) {
  return {
    account: definition.account,
    role: definition.role,
    targetFraction: TARGET_FRACTION_BPS[definition.role] / 10_000,
    lastEffortBps: null,
    lastStakeTx: null,
    lastSeasonFished: null,
    lastCatchTx: null,
    lastVoteCycle: null,
    lastShardCycle: null,
    exiledUntil: null,
    lastError: null,
  };
}

function valueAsBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && value !== null) {
    if ('0' in value) return BigInt(value[0]);
    if ('value' in value) return BigInt(value.value);
  }
  return BigInt(value ?? 0);
}

function numberValue(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function growthForStock(value) {
  const stock = numberValue(value);
  return Math.round(0.6 * stock * (1 - stock / STOCK_CAP) * (stock - 120_000) / STOCK_CAP);
}

function boatCanFish(boat) {
  return boat?.can_fish_now !== false;
}

function boatIsExiled(boat, season) {
  return boat?.exiled_until !== null && boat?.exiled_until !== undefined
    && numberValue(boat.exiled_until) > season;
}

export function effortForRole(boat, role) {
  const fullCatch = valueAsBigInt(boat?.full_effort_catch);
  if (role === 'overfisher') return 10_000;
  if (fullCatch <= 0n) return 0;
  const targetFractionBps = BigInt(TARGET_FRACTION_BPS[role] ?? TARGET_FRACTION_BPS.honest);
  const targetCatch = valueAsBigInt(boat?.fair_share) * targetFractionBps / 10_000n;
  if (targetCatch <= 0n) return 0;
  const effort = targetCatch * 10_000n / fullCatch;
  return Math.max(1, Math.min(10_000, Number(effort)));
}

function transactionHash(result) {
  if (typeof result === 'string') return result;
  return result?.transaction?.hash ?? result?.transaction_outcome?.id ?? result?.hash ?? null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function defaultState() {
  return { actions: {}, accounts: {}, lastRunAt: null, floorActive: false };
}

export function createBots({
  config,
  near = {},
  view: injectedView,
  send: injectedSend,
  logger = console,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const dataDir = config?.dataDir ?? '.';
  const statePath = join(dataDir, 'bots-state.json');
  const state = defaultState();
  const statusByAccount = new Map(BOT_DEFINITIONS.map((definition) => [definition.account, newAccountState(definition)]));
  let initialized = false;
  let initializing;
  let running = false;
  let timer;
  let keyCheckLogged = false;
  let enabled = config?.botsEnabled ?? true;
  const strategy = { stock: null, floorActive: state.floorActive };

  async function persist() {
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporaryPath, statePath);
  }

  async function initialize() {
    if (initialized) return;
    if (initializing) return initializing;
    initializing = (async () => {
      await mkdir(dataDir, { recursive: true });
      try {
        const saved = JSON.parse(await readFile(statePath, 'utf8'));
        if (saved && typeof saved === 'object') {
          if (saved.actions && typeof saved.actions === 'object') Object.assign(state.actions, saved.actions);
          if (saved.lastRunAt) state.lastRunAt = saved.lastRunAt;
          if (typeof saved.floorActive === 'boolean') state.floorActive = saved.floorActive;
          else if (typeof saved.seaFloor === 'boolean') state.floorActive = saved.seaFloor;
          for (const definition of BOT_DEFINITIONS) {
            const savedAccount = saved.accounts?.[definition.account];
            if (savedAccount && typeof savedAccount === 'object') {
              Object.assign(statusByAccount.get(definition.account), savedAccount);
            }
            statusByAccount.get(definition.account).targetFraction = TARGET_FRACTION_BPS[definition.role] / 10_000;
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      strategy.floorActive = state.floorActive;
      initialized = true;
    })().finally(() => { initializing = undefined; });
    return initializing;
  }

  async function availableBotAccounts() {
    if (typeof near.botAccounts !== 'function') return new Set(BOT_DEFINITIONS.map((definition) => definition.account));
    try {
      const configured = await near.botAccounts();
      const known = new Set(BOT_DEFINITIONS.map((definition) => definition.account));
      return new Set([...configured].filter((account) => known.has(account)));
    } catch (error) {
      if (!keyCheckLogged) {
        logger.error?.(`tide bots disabled: ${errorMessage(error)}`);
        keyCheckLogged = true;
      }
      return new Set();
    }
  }

  async function callView(method, args = {}) {
    if (injectedView) return injectedView(method, args);
    if (typeof near.view !== 'function') throw new Error('TIDE view is unavailable.');
    return near.view(config.tideContract, method, args);
  }

  async function sendAction(account, method, args) {
    if (injectedSend) return injectedSend(account, method, args);
    if (typeof near.botSend !== 'function') throw new Error('TIDE bot sender is unavailable.');
    return near.botSend(account, config.tideContract, [actions.functionCall(method, args, BOT_GAS, 0n)]);
  }

  async function saveError(account, error) {
    const status = statusByAccount.get(account);
    status.lastError = errorMessage(error);
    try { await persist(); } catch (persistError) { logger.error?.(`tide bots state error: ${errorMessage(persistError)}`); }
  }

  async function act(definition, season, actionName, method, args, update) {
    const keyPart = actionName === 'stake' ? 'stake' : actionName === 'fish' ? season : Math.floor(season / 3);
    const key = `${definition.account}:${keyPart}:${actionName}`;
    if (state.actions[key]) return false;
    try {
      const result = await sendAction(definition.account, method, args);
      state.actions[key] = { account: definition.account, action: actionName, season, cycle: Math.floor(season / 3), tx: transactionHash(result), at: now().toISOString() };
      const status = statusByAccount.get(definition.account);
      Object.assign(status, update(transactionHash(result)));
      status.lastError = null;
      state.accounts[definition.account] = status;
      await persist();
      return true;
    } catch (error) {
      await saveError(definition.account, error);
      logger.error?.(`tide bot error account=${definition.account} action=${actionName}: ${errorMessage(error)}`);
      return false;
    }
  }

  function needsStake(boat) {
    if (!boat) return true;
    const stake = boat.stake ?? boat.stake_amount;
    return stake !== undefined && valueAsBigInt(stake) <= 0n;
  }

  async function prepareBot(definition, sea) {
    const season = numberValue(sea.season);
    const status = statusByAccount.get(definition.account);
    const boat = await callView('get_boat', { account_id: definition.account });
    status.exiledUntil = boat?.exiled_until ?? null;
    state.accounts[definition.account] = status;

    if (needsStake(boat)) {
      const stakeKey = `${definition.account}:stake`;
      if (!state.actions[stakeKey]) {
        await act(definition, season, 'stake', 'stake', { amount: BOT_STAKE_AMOUNT.toString() }, (tx) => ({
          lastStakeTx: tx,
        }));
      }
      return null;
    }
    const stakeAction = state.actions[`${definition.account}:stake`];
    if (stakeAction?.season === season) return null;
    return { definition, boat };
  }

  async function processGovernance({ definition, boat }, sea) {
    const season = numberValue(sea.season);
    const status = statusByAccount.get(definition.account);

    if (season % 3 !== 2 || (boat.exiled_until !== null && numberValue(boat.exiled_until) > season)) return;
    const assembly = await callView('get_assembly');
    const cycle = numberValue(assembly?.cycle, Math.floor(season / 3));
    const indictments = await callView('get_indictments', { cycle });
    if (!Array.isArray(indictments)) return;

    if (assembly?.stage === 'hold') {
      const yes = definition.role !== 'overfisher' && indictments.length > 0;
      await act(definition, season, 'vote', 'vote_hold', { yes }, () => ({ lastVoteCycle: cycle }));
      return;
    }

    if (assembly?.stage !== 'shards' || definition.role === 'overfisher') return;
    const holdPassed = numberValue(assembly.hold_yes) * 2 > numberValue(assembly.eligible);
    if (!holdPassed) return;
    const names = indictments
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string')
      .sort((left, right) => valueAsBigInt(right[1]) > valueAsBigInt(left[1]) ? 1 : valueAsBigInt(right[1]) < valueAsBigInt(left[1]) ? -1 : 0)
      .slice(0, 3)
      .map(([account]) => account);
    if (names.length === 0) return;
    await act(definition, season, 'shard', 'write_shard', { names }, () => ({ lastShardCycle: cycle }));
  }

  async function processFishing(entries, sea) {
    const season = numberValue(sea.season);
    if (strategy.stock === null || strategy.floorActive) return;
    const cycle = numberValue(sea.cycle, Math.floor(season / 3));
    const ordered = [...entries].sort(({ definition: left }, { definition: right }) => {
      return left.role === 'overfisher' ? -1 : right.role === 'overfisher' ? 1 : 0;
    });
    for (const { definition, boat } of ordered) {
      if (!boatCanFish(boat) || boatIsExiled(boat, season)) continue;
      if (definition.role === 'overfisher' && cycle % 2 !== 0) continue;
      const effort = effortForRole(boat, definition.role);
      if (effort === 0) continue;
      await act(definition, season, 'fish', 'fish', { effort_bps: effort }, (tx) => ({
        lastSeasonFished: season,
        lastCatchTx: tx,
        lastEffortBps: effort,
      }));
    }
  }

  function updateStrategy(sea) {
    const rawStock = sea.stock_fish ?? sea.stock;
    const stock = Number(rawStock);
    strategy.stock = Number.isFinite(stock) ? stock : null;
    if (strategy.stock === null) {
      strategy.floorActive = state.floorActive;
      return;
    }
    if (stock < FLOOR_TRIGGER_STOCK) state.floorActive = true;
    else if (state.floorActive && stock > FLOOR_RECOVERY_STOCK) state.floorActive = false;
    strategy.floorActive = state.floorActive;
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      await initialize();
      state.lastRunAt = now().toISOString();
      if (!enabled) {
        await persist();
        return;
      }
      const available = await availableBotAccounts();
      if (typeof near.botAccounts === 'function' && available.size === 0) {
        enabled = false;
        if (!keyCheckLogged) {
          logger.error?.('tide bots disabled: no usable bot keys were found.');
          keyCheckLogged = true;
        }
        await persist();
        return;
      }
      const sea = await callView('get_sea');
      updateStrategy(sea);
      if (numberValue(sea?.seasons_behind) > 30) {
        await persist();
        return;
      }
      const prepared = [];
      for (const definition of BOT_DEFINITIONS) {
        if (!available.has(definition.account)) continue;
        try {
          const entry = await prepareBot(definition, sea);
          if (entry) prepared.push(entry);
        } catch (error) {
          await saveError(definition.account, error);
          logger.error?.(`tide bot error account=${definition.account}: ${errorMessage(error)}`);
        }
      }
      await processFishing(prepared, sea);
      for (const entry of prepared) {
        try {
          await processGovernance(entry, sea);
        } catch (error) {
          await saveError(entry.definition.account, error);
          logger.error?.(`tide bot error account=${entry.definition.account}: ${errorMessage(error)}`);
        }
      }
      await persist();
    } catch (error) {
      logger.error?.(`tide bots error: ${errorMessage(error)}`);
      try { await persist(); } catch (persistError) { logger.error?.(`tide bots state error: ${errorMessage(persistError)}`); }
    } finally {
      running = false;
    }
  }

  function status() {
    return {
      enabled,
      accounts: BOT_DEFINITIONS.map(({ account }) => ({ ...statusByAccount.get(account) })),
      lastRunAt: state.lastRunAt,
      stock: strategy.stock,
      floorActive: strategy.floorActive,
    };
  }

  function summary() {
    const active = status().accounts.filter((account) => account.lastSeasonFished !== null).length;
    return `${enabled ? 'enabled' : 'disabled'}; ${active}/${BOT_DEFINITIONS.length} captains have fished; last run ${state.lastRunAt ?? 'never'}`;
  }

  function start() {
    if (!enabled || timer) return;
    timer = setIntervalFn(() => { void run(); }, config.botsIntervalMs);
    void run();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = undefined;
  }

  return { state, initialize, ready: initialize, run, start, stop, status, summary };
}

export { BOT_ACCOUNTS, BOT_DEFINITIONS };
