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
const DEFAULT_CAPACITY = 1_000_000;
const DEFAULT_STAGE_SAFETY_MS = 8_000;
const TIDE_DECIMALS = 10n ** 18n;
const DEFAULT_RESEED_BOT_SHARE = 150_000n * TIDE_DECIMALS;
const SUSTAINABLE_FRACTION = 0.689;
const HARD_FLOOR_FRACTION = 0.4;
const RECOVERY_FRACTION = 0.5;
const ALLEE_THRESHOLD_STOCK = 120_000;
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
    reseedContributed: false,
    reseedGeneration: null,
    lastReseedTx: null,
    exiledUntil: null,
    lastError: null,
  };
}

function valueAsBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && value !== null) {
    if ('0' in value) return BigInt(value[0]);
    if ('value' in value) return BigInt(value.value);
    if ('balance' in value) return BigInt(value.balance);
    if ('amount' in value) return BigInt(value.amount);
  }
  return BigInt(value ?? 0);
}

function numberValue(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function capacityValue(value) {
  const capacity = numberValue(value, DEFAULT_CAPACITY);
  return capacity > 0 ? capacity : DEFAULT_CAPACITY;
}

export function growthForStock(value, capacity = DEFAULT_CAPACITY, alleeThreshold = ALLEE_THRESHOLD_STOCK) {
  const stock = numberValue(value);
  const cap = capacityValue(capacity);
  return Math.round(0.6 * stock * (1 - stock / cap) * (stock - numberValue(alleeThreshold, ALLEE_THRESHOLD_STOCK)) / cap);
}

function levelsForCapacity(capacity) {
  const cap = capacityValue(capacity);
  return {
    capacity: cap,
    sustainable: Math.round(SUSTAINABLE_FRACTION * cap),
    floor: Math.round(HARD_FLOOR_FRACTION * cap),
    recovery: Math.round(RECOVERY_FRACTION * cap),
  };
}

function phaseValue(value) {
  const normalized = String(value ?? 'Fishing').toLowerCase().replace(/[_ -]/g, '');
  if (normalized === 'wrecked') return 'Wrecked';
  if (normalized === 'recovering') return 'Recovering';
  if (normalized === 'lostforever' || normalized === 'sealostforever') return 'sea_lost_forever';
  return 'Fishing';
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

function isExpectedAssemblyPanic(error) {
  return /not the (?:first|second) half/i.test(errorMessage(error));
}

function stageSecondsLeft(sea, stage) {
  const secondsLeft = Number(sea?.seconds_left_in_season);
  const seasonLength = Number(sea?.season_len_sec);
  if (!Number.isFinite(secondsLeft) || !Number.isFinite(seasonLength) || seasonLength <= 0) return null;
  return stage === 'hold' ? secondsLeft - seasonLength / 2 : secondsLeft;
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
  const stageSafetyMs = Math.max(0, numberValue(config?.stageSafetyMs, DEFAULT_STAGE_SAFETY_MS));
  const strategy = {
    stock: null,
    floorActive: state.floorActive,
    capacity: null,
    sustainable: null,
    floor: null,
    generation: null,
    phase: 'Fishing',
    lostForever: false,
  };
  const reseedShare = config?.reseedBotShare === undefined
    ? DEFAULT_RESEED_BOT_SHARE
    : valueAsBigInt(config.reseedBotShare);

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

  function actionKey(definition, season, generation, actionName) {
    const keyPart = actionName === 'stake' || actionName === 'reseed'
      ? generation
      : actionName === 'fish' ? season : Math.floor(season / 3);
    return `${definition.account}:${keyPart}:${actionName}`;
  }

  async function act(definition, season, generation, actionName, method, args, update) {
    const key = actionKey(definition, season, generation, actionName);
    if (state.actions[key]) return false;
    try {
      const result = await sendAction(definition.account, method, args);
      state.actions[key] = { account: definition.account, action: actionName, generation, season, cycle: Math.floor(season / 3), tx: transactionHash(result), at: now().toISOString() };
      const status = statusByAccount.get(definition.account);
      Object.assign(status, update(transactionHash(result)));
      status.lastError = null;
      state.accounts[definition.account] = status;
      await persist();
      return true;
    } catch (error) {
      if (isExpectedAssemblyPanic(error)) {
        const status = statusByAccount.get(definition.account);
        status.lastError = null;
        state.accounts[definition.account] = status;
        logger.debug?.(`tide bot expected account=${definition.account} action=${actionName}: ${errorMessage(error)}`);
        return false;
      }
      await saveError(definition.account, error);
      logger.error?.(`tide bot error account=${definition.account} action=${actionName}: ${errorMessage(error)}`);
      return false;
    }
  }

  function needsStake(boat) {
    if (!boat) return true;
    const stake = boat.stake ?? boat.stake_amount ?? boat.boat?.stake;
    return stake !== undefined && valueAsBigInt(stake) <= 0n;
  }

  async function prepareBot(definition, sea) {
    const season = numberValue(sea.season);
    const generation = strategy.generation;
    const status = statusByAccount.get(definition.account);
    const boat = await callView('get_boat', { account_id: definition.account });
    status.exiledUntil = boat?.exiled_until ?? null;
    state.accounts[definition.account] = status;

    if (needsStake(boat)) {
      const stakeKey = actionKey(definition, season, generation, 'stake');
      if (!state.actions[stakeKey]) {
        await act(definition, season, generation, 'stake', 'stake', { amount: BOT_STAKE_AMOUNT.toString() }, (tx) => ({
          lastStakeTx: tx,
        }));
      }
      return null;
    }
    const stakeAction = state.actions[actionKey(definition, season, generation, 'stake')]
      ?? (generation === 0 ? state.actions[`${definition.account}:stake`] : null);
    if (stakeAction?.season === season && stakeAction?.generation === undefined) return null;
    if (stakeAction?.season === season && stakeAction?.generation === generation) return null;
    return { definition, boat };
  }

  async function processReseed(definition, sea) {
    if (definition.role === 'overfisher') return;
    const season = numberValue(sea.season);
    const generation = strategy.generation;
    const status = statusByAccount.get(definition.account);
    const key = actionKey(definition, season, generation, 'reseed');
    if (state.actions[key] || status.reseedGeneration === generation) {
      status.reseedContributed = true;
      status.reseedGeneration = generation;
      state.accounts[definition.account] = status;
      return;
    }
    const balance = await callView('ft_balance_of', { account_id: definition.account });
    if (valueAsBigInt(balance) < reseedShare) return;
    await act(definition, season, generation, 'reseed', 'contribute_reseed', { amount: reseedShare.toString() }, (tx) => ({
      reseedContributed: true,
      reseedGeneration: generation,
      lastReseedTx: tx,
    }));
  }

  async function processGovernance({ definition, boat }, sea) {
    const season = numberValue(sea.season);
    const status = statusByAccount.get(definition.account);

    if (season % 3 !== 2 || (boat.exiled_until !== null && numberValue(boat.exiled_until) > season)) return;
    const assembly = await callView('get_assembly');
    const cycle = numberValue(assembly?.cycle, Math.floor(season / 3));

    if (assembly?.stage === 'hold') {
      const secondsLeft = stageSecondsLeft(sea, 'hold');
      if (secondsLeft === null || secondsLeft * 1000 < stageSafetyMs) {
        logger.debug?.(`tide bot skip account=${definition.account} action=vote: ${secondsLeft === null ? 'assembly timing unavailable' : `${secondsLeft * 1000}ms left in hold`}`);
        return;
      }
      const indictments = await callView('get_indictments', { cycle });
      if (!Array.isArray(indictments)) return;
      const yes = definition.role !== 'overfisher' && indictments.length > 0;
      await act(definition, season, strategy.generation, 'vote', 'vote_hold', { yes }, () => ({ lastVoteCycle: cycle }));
      return;
    }

    if (assembly?.stage !== 'shards' || definition.role === 'overfisher') return;
    const secondsLeft = stageSecondsLeft(sea, 'shards');
    if (secondsLeft === null || secondsLeft * 1000 < stageSafetyMs) {
      logger.debug?.(`tide bot skip account=${definition.account} action=shard: ${secondsLeft === null ? 'assembly timing unavailable' : `${secondsLeft * 1000}ms left in shards`}`);
      return;
    }
    const indictments = await callView('get_indictments', { cycle });
    if (!Array.isArray(indictments)) return;
    const holdPassed = numberValue(assembly.hold_yes) * 2 > numberValue(assembly.eligible);
    if (!holdPassed) return;
    const names = indictments
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string')
      .sort((left, right) => valueAsBigInt(right[1]) > valueAsBigInt(left[1]) ? 1 : valueAsBigInt(right[1]) < valueAsBigInt(left[1]) ? -1 : 0)
      .slice(0, 3)
      .map(([account]) => account);
    if (names.length === 0) return;
    await act(definition, season, strategy.generation, 'shard', 'write_shard', { names }, () => ({ lastShardCycle: cycle }));
  }

  async function processFishing(entries, sea) {
    const season = numberValue(sea.season);
    if (strategy.stock === null || strategy.floorActive || strategy.phase === 'Wrecked' || strategy.lostForever) return;
    const cycle = numberValue(sea.cycle, Math.floor(season / 3));
    const ordered = [...entries].sort(({ definition: left }, { definition: right }) => {
      return left.role === 'overfisher' ? -1 : right.role === 'overfisher' ? 1 : 0;
    });
    for (const { definition, boat } of ordered) {
      if (!boatCanFish(boat) || boatIsExiled(boat, season)) continue;
      if (definition.role === 'overfisher' && cycle % 2 !== 0) continue;
      const effort = effortForRole(boat, definition.role);
      if (effort === 0) continue;
      await act(definition, season, strategy.generation, 'fish', 'fish', { effort_bps: effort }, (tx) => ({
        lastSeasonFished: season,
        lastCatchTx: tx,
        lastEffortBps: effort,
      }));
    }
  }

  function updateStrategy(sea) {
    const rawStock = sea.stock_fish ?? sea.stock;
    const stock = Number(rawStock);
    const levels = levelsForCapacity(sea.carrying_capacity);
    const generation = Number.isSafeInteger(Number(sea.generation)) ? Number(sea.generation) : 0;
    const phase = phaseValue(sea.phase);
    const alleeThreshold = numberValue(sea.allee_threshold, 0);
    const lostForever = phase === 'sea_lost_forever' || sea.sea_lost_forever === true || sea.lost_forever === true
      || (phase === 'Wrecked' && sea.dead === true && alleeThreshold > 0 && levels.capacity <= alleeThreshold);
    strategy.capacity = levels.capacity;
    strategy.sustainable = levels.sustainable;
    strategy.floor = phase === 'Recovering' ? levels.recovery : levels.floor;
    strategy.generation = generation;
    strategy.phase = lostForever ? 'sea_lost_forever' : phase;
    strategy.lostForever = lostForever;
    for (const status of statusByAccount.values()) {
      if (status.reseedGeneration !== generation) status.reseedContributed = false;
    }
    strategy.stock = Number.isFinite(stock) ? stock : null;
    if (strategy.stock === null) {
      strategy.floorActive = state.floorActive;
      return;
    }
    const trigger = phase === 'Recovering' ? levels.recovery : levels.floor;
    if (stock < trigger) state.floorActive = true;
    else if (state.floorActive && stock > levels.recovery) state.floorActive = false;
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
      if (strategy.lostForever) {
        await persist();
        return;
      }
      if (numberValue(sea?.seasons_behind) > 30) {
        await persist();
        return;
      }
      if (strategy.phase === 'Wrecked') {
        for (const definition of BOT_DEFINITIONS) {
          if (!available.has(definition.account)) continue;
          try {
            await processReseed(definition, sea);
          } catch (error) {
            await saveError(definition.account, error);
            logger.error?.(`tide bot error account=${definition.account} action=reseed: ${errorMessage(error)}`);
          }
        }
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
          if (strategy.phase === 'Wrecked') continue;
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
      generation: strategy.generation,
      phase: strategy.phase,
      capacity: strategy.capacity,
      sustainable: strategy.sustainable,
      floor: strategy.floor,
      floorActive: strategy.floorActive,
      seaLostForever: strategy.lostForever,
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
