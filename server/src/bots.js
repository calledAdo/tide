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

function newAccountState(definition) {
  return {
    account: definition.account,
    role: definition.role,
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

export function effortForRole(boat, role) {
  if (role === 'overfisher') return 10_000;
  const fullCatch = valueAsBigInt(boat?.full_effort_catch);
  if (fullCatch <= 0n) return 1;
  const fairEffort = (valueAsBigInt(boat?.fair_share) * 10_000n) / fullCatch;
  const effort = role === 'cautious' ? (fairEffort * 80n) / 100n : fairEffort;
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
  return { actions: {}, accounts: {}, lastRunAt: null };
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
          for (const definition of BOT_DEFINITIONS) {
            const savedAccount = saved.accounts?.[definition.account];
            if (savedAccount && typeof savedAccount === 'object') {
              Object.assign(statusByAccount.get(definition.account), savedAccount);
            }
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
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
    const keyPart = actionName === 'fish' ? season : Math.floor(season / 3);
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

  async function processBot(definition, sea) {
    const season = numberValue(sea.season);
    const status = statusByAccount.get(definition.account);
    const boat = await callView('get_boat', { account_id: definition.account });
    status.exiledUntil = boat?.exiled_until ?? null;
    state.accounts[definition.account] = status;
    if (!boat) {
      await persist();
      return;
    }

    if (boat.can_fish_now) {
      await act(definition, season, 'fish', 'fish', { effort_bps: effortForRole(boat, definition.role) }, (tx) => ({
        lastSeasonFished: season,
        lastCatchTx: tx,
      }));
    }

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
      if (numberValue(sea?.seasons_behind) > 30) {
        await persist();
        return;
      }
      for (const definition of BOT_DEFINITIONS) {
        if (!available.has(definition.account)) continue;
        try {
          await processBot(definition, sea);
        } catch (error) {
          await saveError(definition.account, error);
          logger.error?.(`tide bot error account=${definition.account}: ${errorMessage(error)}`);
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
