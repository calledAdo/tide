import { actions, TGAS } from './near.js';

const MAX_TICKS_PER_RUN = 5;

function seasonsBehind(sea) {
  const value = sea?.seasons_behind;
  const result = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('TIDE returned an invalid seasons_behind value.');
  return result;
}

function hashFrom(result) {
  const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id ?? result;
  if (typeof hash !== 'string') throw new Error('TIDE tick did not return a transaction hash.');
  return hash;
}

export function createKeeper({ config, near, logger = console, now = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const state = {
    enabled: config.keeperEnabled,
    lastRunAt: null,
    lastTickAt: null,
    lastTickHash: null,
    lastError: null,
  };
  let running = false;
  let timer;

  async function run() {
    if (running || !state.enabled) return;
    running = true;
    state.lastRunAt = now().toISOString();
    try {
      let sea = await near.view(config.tideContract, 'get_sea', {});
      state.lastError = null;
      for (let count = 0; count < MAX_TICKS_PER_RUN; count += 1) {
        const before = seasonsBehind(sea);
        if (before === 0) break;
        const result = await near.send(config.tideContract, [actions.functionCall('tick', {}, 300n * TGAS, 0n)]);
        const hash = hashFrom(result);
        sea = await near.view(config.tideContract, 'get_sea', {});
        const after = seasonsBehind(sea);
        state.lastTickAt = now().toISOString();
        state.lastTickHash = hash;
        state.lastError = null;
        logger.info?.(`tide keeper tick before=${before} after=${after} hash=${hash}`);
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.error?.(`tide keeper error: ${state.lastError}`);
    } finally {
      running = false;
    }
  }

  function start() {
    if (!state.enabled || timer) return;
    timer = setIntervalFn(() => { void run(); }, config.keeperIntervalMs);
    void run();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = undefined;
  }

  return { state, run, start, stop };
}

export { MAX_TICKS_PER_RUN };
