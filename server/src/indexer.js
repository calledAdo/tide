import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_FASTNEAR_TX_URL = 'https://tx.test.fastnear.com';
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_SWEEP_MS = 300_000;
const ACCOUNT_PAGE_SIZE = 150;
const TRANSACTION_BATCH_SIZE = 20;
const RETRIES = 4;
const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000];

function asNumber(value, fallback = null) {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : fallback;
}

function amount(value) {
  return String(value ?? '0');
}

function addAmounts(left, right) {
  return (BigInt(left) + BigInt(right)).toString();
}

function accountIn(value, account) {
  if (value === account) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((child) => accountIn(child, account));
}

function successStatus(status) {
  return Boolean(status && (Object.hasOwn(status, 'SuccessValue') || Object.hasOwn(status, 'SuccessReceiptId')));
}

function eventAccount(record) {
  const data = record.data;
  return data?.account ?? data?.owner_id ?? data?.old_owner_id ?? null;
}

function eventIdentity(record) {
  const txHash = record.tx_hash ?? record.tx;
  const receipt = record.receipt_id ?? record.receipt;
  const logIndex = record.log_index ?? record.logIndex;
  const dataIndex = record.data_index ?? record.dataIndex;
  if (typeof txHash === 'string' && txHash && typeof receipt === 'string' && receipt &&
      Number.isSafeInteger(logIndex) && Number.isSafeInteger(dataIndex)) {
    return JSON.stringify([txHash, receipt, logIndex, dataIndex]);
  }
  // Legacy records lack receipt and log coordinates. Their event payload is
  // the only stable identity available to the indexer.
  return JSON.stringify([txHash ?? null, record.event ?? null, JSON.stringify(record.data ?? null)]);
}

function parseEvents(transactionResult, contractId, accountTx = {}) {
  const height = asNumber(accountTx?.tx_block_height);
  let ts;
  try {
    ts = Number(BigInt(accountTx?.tx_block_timestamp ?? 0) / 1_000_000n);
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(height)) return [];

  const tx = accountTx?.transaction_hash ?? transactionResult?.transaction?.hash;
  if (!tx) return [];
  const events = [];
  for (const receipt of transactionResult?.receipts ?? []) {
    const outcome = receipt?.execution_outcome?.outcome;
    if (outcome?.executor_id !== contractId || !successStatus(outcome?.status)) continue;
    const receiptId = receipt?.execution_outcome?.id ?? receipt?.receipt?.receipt_id;
    for (const [logIndex, log] of (outcome.logs ?? []).entries()) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      try {
        const parsed = JSON.parse(log.slice('EVENT_JSON:'.length));
        if (!['tide', 'nep141'].includes(parsed?.standard) || typeof parsed.event !== 'string') continue;
        for (const [dataIndex, data] of (Array.isArray(parsed.data) ? parsed.data : []).entries()) {
          events.push({
            height,
            ts,
            tx,
            tx_hash: tx,
            receipt_id: receiptId,
            log_index: logIndex,
            data_index: dataIndex,
            standard: parsed.standard,
            event: parsed.event,
            data,
          });
        }
      } catch {
        // A malformed application log is not allowed to stop transaction indexing.
      }
    }
  }
  return events;
}

function createAssembly(cycle) {
  return { cycle, held: null, holdYes: 0, holdNo: 0, eligible: 0, shards: {}, exiled: [], closedAt: null };
}

function createGeneration(generation) {
  return {
    generation,
    diedSeason: null,
    boatsWrecked: 0,
    burnedTotal: '0',
    reseededSeason: null,
    funded: false,
    contributors: new Map(),
    wreckedAccounts: new Set(),
    hasWreckCount: false,
    hasBurnedTotal: false,
  };
}

function sortNewest(records) {
  return [...records].sort((a, b) => b.height - a.height || b.ts - a.ts || String(b.tx).localeCompare(String(a.tx)));
}

export function createDerivedIndexes() {
  const state = {
    events: [],
    eventIds: new Set(),
    eventPositions: new Map(),
    boats: new Map(),
    assemblies: new Map(),
    generations: new Map(),
  };

  function generationForRecord(record, data) {
    const explicit = asNumber(data.generation ?? data.generation_id);
    if (explicit !== null) return explicit;
    if (!['boat_wrecked', 'reseed_contribution'].includes(record.event)) return null;
    const reckoning = state.events
      .filter((item) => item.event === 'reckoning' && (asNumber(item.height) === null || asNumber(item.height) <= asNumber(record.height)))
      .sort((left, right) => asNumber(right.height, -1) - asNumber(left.height, -1))[0];
    return reckoning ? asNumber(reckoning.data?.generation ?? reckoning.data?.generation_id) : null;
  }

  function indexRecord(record) {
    const data = record.data ?? {};
    const account = eventAccount(record);
    if (account) {
      if (!state.boats.has(account)) state.boats.set(account, []);
      state.boats.get(account).push(record);
    }
    if (record.event === 'hold_vote' || record.event === 'shard' || record.event === 'assembly_closed' || record.event === 'exiled') {
      const cycle = asNumber(data.cycle);
      if (cycle === null) return;
      if (!state.assemblies.has(cycle)) state.assemblies.set(cycle, createAssembly(cycle));
      const assembly = state.assemblies.get(cycle);
      if (record.event === 'hold_vote') {
        if (data.yes) assembly.holdYes += 1;
        else assembly.holdNo += 1;
      } else if (record.event === 'shard') {
        for (const name of data.names ?? []) assembly.shards[name] = (assembly.shards[name] ?? 0) + 1;
      } else if (record.event === 'exiled') {
        if (!assembly.exiled.includes(data.account)) assembly.exiled.push(data.account);
      } else {
        assembly.held = Boolean(data.held);
        assembly.holdYes = asNumber(data.hold_yes, assembly.holdYes);
        assembly.holdNo = asNumber(data.hold_no, assembly.holdNo);
        assembly.eligible = asNumber(data.eligible, assembly.eligible);
        assembly.closedAt = { height: record.height, ts: record.ts, tx: record.tx };
        for (const name of data.exiled ?? []) {
          if (!assembly.exiled.includes(name)) assembly.exiled.push(name);
        }
      }
    }
    if (['reckoning', 'boat_wrecked', 'reseed_contribution', 'reseeded'].includes(record.event)) {
      const generation = generationForRecord(record, data);
      if (generation === null) return;
      if (!state.generations.has(generation)) state.generations.set(generation, createGeneration(generation));
      const entry = state.generations.get(generation);
      if (record.event === 'reckoning') {
        const diedSeason = asNumber(data.died_season ?? data.season);
        if (diedSeason !== null) entry.diedSeason = diedSeason;
        const boatsWrecked = asNumber(data.boats_wrecked ?? data.boats ?? data.wrecked);
        if (boatsWrecked !== null) {
          entry.boatsWrecked = boatsWrecked;
          entry.hasWreckCount = true;
        }
        const burned = data.burned_total ?? data.burned;
        if (burned !== undefined) {
          entry.burnedTotal = amount(burned);
          entry.hasBurnedTotal = true;
        }
      } else if (record.event === 'boat_wrecked') {
        const account = data.account ?? data.owner_id;
        if (typeof account === 'string' && account) entry.wreckedAccounts.add(account);
        if (!entry.hasWreckCount) entry.boatsWrecked = entry.wreckedAccounts.size;
        if (!entry.hasBurnedTotal && (data.burned ?? data.burned_total ?? data.stake_burned) !== undefined) {
          entry.burnedTotal = addAmounts(entry.burnedTotal, amount(data.burned ?? data.burned_total ?? data.stake_burned));
        }
        const diedSeason = asNumber(data.died_season ?? data.season);
        if (entry.diedSeason === null && diedSeason !== null) entry.diedSeason = diedSeason;
      } else if (record.event === 'reseed_contribution') {
        const account = data.account ?? data.owner_id;
        const contribution = amount(data.amount ?? data.contribution);
        if (typeof account === 'string' && account) {
          const previous = entry.contributors.get(account) ?? '0';
          entry.contributors.set(account, addAmounts(previous, contribution));
        }
      } else {
        const reseededSeason = asNumber(data.reseeded_season ?? data.season);
        if (reseededSeason !== null) entry.reseededSeason = reseededSeason;
        if (data.funded !== undefined) entry.funded = data.funded;
        else if (data.amount !== undefined) entry.funded = data.amount;
        else entry.funded = true;
        if (entry.contributors.size === 0 && Array.isArray(data.contributors)) {
          for (const contributor of data.contributors) {
            if (!Array.isArray(contributor) || typeof contributor[0] !== 'string') continue;
            entry.contributors.set(contributor[0], amount(contributor[1]));
          }
        }
      }
    }
  }

  function rebuildDerivedIndexes() {
    state.boats.clear();
    state.assemblies.clear();
    state.generations.clear();
    for (const record of state.events) indexRecord(record);
  }

  function lowerHeight(left, right) {
    const leftHeight = asNumber(left?.height);
    const rightHeight = asNumber(right?.height);
    if (rightHeight === null) return leftHeight !== null;
    if (leftHeight === null) return false;
    return rightHeight < leftHeight;
  }

  function add(record) {
    const identity = eventIdentity(record);
    const position = state.eventPositions.get(identity);
    if (position !== undefined) {
      if (!lowerHeight(state.events[position], record)) return false;
      state.events[position] = record;
      rebuildDerivedIndexes();
      return true;
    }
    state.eventIds.add(identity);
    state.eventPositions.set(identity, state.events.length);
    state.events.push(record);
    indexRecord(record);
    return true;
  }

  function recordsFor(account) {
    return account ? (state.boats.get(account) ?? []) : [];
  }

  function boatHistory(account) {
    const records = recordsFor(account);
    const catches = records.filter((record) => record.event === 'catch' && record.data.account === account);
    const fuels = records.filter((record) => record.event === 'ft_burn' && record.data.owner_id === account && record.data.memo === 'fuel');
    const fuelByTx = new Map(fuels.map((record) => [record.tx, amount(record.data.amount)]));
    const catchTotal = catches.reduce((total, record) => addAmounts(total, amount(record.data.catch)), '0');
    const fuelTotal = catches.reduce((total, record) => addAmounts(total, amount(record.data.fuel ?? fuelByTx.get(record.tx) ?? '0')), '0');
    const trips = sortNewest(catches).map((record) => ({
      season: asNumber(record.data.season),
      catch: amount(record.data.catch),
      fuel: amount(record.data.fuel ?? fuelByTx.get(record.tx) ?? '0'),
      fairShare: amount(record.data.fair_share),
      effortBps: asNumber(record.data.effort_bps),
      tx: record.tx,
      ts: record.ts,
    }));
    const indictments = sortNewest(records.filter((record) => record.event === 'indicted' && record.data.account === account))
      .map((record) => ({ season: asNumber(record.data.season), cycle: asNumber(record.data.cycle), overShare: amount(record.data.over_share), tx: record.tx }));
    const exiles = sortNewest(records.filter((record) => record.event === 'exiled' && record.data.account === account))
      .map((record) => ({ cycle: asNumber(record.data.cycle), untilSeason: asNumber(record.data.until_season), tx: record.tx }));
    const votes = sortNewest(records.filter((record) => record.event === 'hold_vote' && record.data.account === account))
      .map((record) => ({ cycle: asNumber(record.data.cycle), yes: Boolean(record.data.yes), tx: record.tx, ts: record.ts }));
    const shards = sortNewest(records.filter((record) => record.event === 'shard' && record.data.account === account))
      .map((record) => ({ cycle: asNumber(record.data.cycle), names: record.data.names ?? [], tx: record.tx, ts: record.ts }));
    const stakes = sortNewest(records.filter((record) => (record.event === 'boat_staked' || record.event === 'boat_unstaked') && record.data.account === account))
      .map((record) => ({ action: record.event === 'boat_staked' ? 'staked' : 'unstaked', stake: amount(record.data.stake), ...(record.data.burned === undefined ? {} : { burned: amount(record.data.burned) }), tx: record.tx, ts: record.ts }));
    return {
      account,
      totals: {
        catch: catchTotal,
        fuel: fuelTotal,
        net: addAmounts(catchTotal, `-${fuelTotal}`),
        trips: trips.length,
        indictments: indictments.length,
        overageTotal: indictments.reduce((total, item) => addAmounts(total, item.overShare), '0'),
        exiles: exiles.length,
        votesYes: votes.filter((vote) => vote.yes).length,
        votesNo: votes.filter((vote) => !vote.yes).length,
        shardsWritten: shards.length,
      },
      trips,
      indictments,
      exiles,
      stakes,
      votes,
      shards,
    };
  }

  function leaderboard(by = 'catch') {
    const accounts = new Set(state.boats.keys());
    const rows = [...accounts].map((account) => {
      const history = boatHistory(account);
      return {
        account,
        catch: history.totals.catch,
        fuel: history.totals.fuel,
        net: history.totals.net,
        trips: history.totals.trips,
        indictments: history.totals.indictments,
        exiles: history.totals.exiles,
        lastFishedSeason: history.trips[0]?.season ?? null,
      };
    });
    return rows.sort((a, b) => {
      const comparison = BigInt(b[by]) - BigInt(a[by]);
      return comparison === 0n ? a.account.localeCompare(b.account) : (comparison > 0n ? 1 : -1);
    }).slice(0, 50);
  }

  function generations(limit = 20) {
    return [...state.generations.values()]
      .sort((left, right) => right.generation - left.generation)
      .slice(0, limit)
      .map((entry) => ({
        generation: entry.generation,
        diedSeason: entry.diedSeason,
        boatsWrecked: entry.boatsWrecked,
        burnedTotal: entry.burnedTotal,
        reseededSeason: entry.reseededSeason,
        funded: entry.funded,
        contributors: [...entry.contributors.entries()],
      }));
  }

  return {
    add,
    has: (record) => state.eventPositions.has(eventIdentity(record)),
    count: () => state.events.length,
    events({ limit = 50, before = null, event = null, account = null } = {}) {
      return sortNewest(state.events.filter((record) =>
        (before === null || record.height < before) &&
        (!event || record.event === event) &&
        (!account || accountIn(record.data, account)),
      )).slice(0, limit);
    },
    boatHistory,
    assemblies(limit = 20, active = false) {
      const records = [...state.assemblies.values()]
        .filter((assembly) => !active || assembly.holdYes > 0 || assembly.holdNo > 0
          || Object.values(assembly.shards).some((count) => count > 0)
          || assembly.exiled.length > 0)
        .sort((a, b) => b.cycle - a.cycle)
        .slice(0, limit);
      return records.map((assembly) => ({ ...assembly, shards: { ...assembly.shards }, exiled: [...assembly.exiled], closedAt: assembly.closedAt && { ...assembly.closedAt } }));
    },
    leaderboard,
    generations,
  };
}

export function createIndexer({
  config,
  fetchFn = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  now = () => Date.now(),
} = {}) {
  const settings = {
    enabled: config?.indexerEnabled ?? true,
    fastNearTxUrl: (config?.fastNearTxUrl ?? DEFAULT_FASTNEAR_TX_URL).replace(/\/$/, ''),
    pollMs: config?.indexerPollMs ?? DEFAULT_POLL_MS,
    sweepMs: config?.indexerSweepMs ?? DEFAULT_SWEEP_MS,
    dataDir: config?.dataDir ?? '.',
    contractId: config?.tideContract,
  };
  const indexedTxsPath = join(settings.dataDir, 'indexed-txs.json');
  const eventsPath = join(settings.dataDir, 'events.jsonl');
  const indexes = createDerivedIndexes();
  const indexedTxs = new Set();
  const state = {
    enabled: settings.enabled,
    txsTotal: null,
    lastPollAt: null,
    lastSweepAt: null,
    lastError: null,
  };
  let initialized = false;
  let initializing;
  let running = false;
  let initialPollDone = false;

  async function initialize() {
    if (initialized) return;
    if (initializing) return initializing;
    initializing = (async () => {
      await mkdir(settings.dataDir, { recursive: true });
      try {
        const contents = await readFile(eventsPath, 'utf8');
        let duplicates = false;
        for (const line of contents.split('\n')) {
          if (!line.trim()) continue;
          try {
            const record = JSON.parse(line);
            const existed = indexes.has(record);
            indexes.add(record);
            if (existed) duplicates = true;
          } catch { /* ignore a truncated final line */ }
        }
        if (duplicates) {
          const records = indexes.events({ limit: Number.MAX_SAFE_INTEGER });
          await writeFile(eventsPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        const saved = JSON.parse(await readFile(indexedTxsPath, 'utf8'));
        const hashes = Array.isArray(saved) ? saved : saved?.hashes;
        if (Array.isArray(hashes)) {
          for (const hash of hashes) if (typeof hash === 'string' && hash) indexedTxs.add(hash);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      initialized = true;
    })().catch((error) => {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.error?.(`tide indexer initialization error: ${state.lastError}`);
      throw error;
    }).finally(() => { initializing = undefined; });
    return initializing;
  }

  async function fetchJson(path, body) {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        const response = await fetchFn(`${settings.fastNearTxUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const status = response.status ?? (response.ok ? 200 : 500);
        if (response.ok === false || status >= 400) {
          const error = new Error(`FastNEAR HTTP ${status}`);
          error.status = status;
          throw error;
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        const retryable = error?.status === 429 || error?.status >= 500 || error?.status === undefined;
        if (!retryable || attempt >= RETRIES - 1) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async function persistIndexedTxs() {
    const temporaryPath = `${indexedTxsPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify([...indexedTxs])}\n`);
    await rename(temporaryPath, indexedTxsPath);
  }

  async function fetchAccountPage(maxBlockHeight = null) {
    const body = { account_id: settings.contractId };
    if (maxBlockHeight !== null) body.max_block_height = maxBlockHeight;
    const result = await fetchJson('/v0/account', body);
    if (Number.isSafeInteger(Number(result?.txs_count))) state.txsTotal = Number(result.txs_count);
    return Array.isArray(result?.account_txs) ? result.account_txs : [];
  }

  async function collectAccountTransactions({ fullSweep = false } = {}) {
    const entries = [];
    let maxBlockHeight = null;
    while (true) {
      const page = await fetchAccountPage(maxBlockHeight);
      entries.push(...page);
      const hashes = page.map((entry) => entry?.transaction_hash).filter((hash) => typeof hash === 'string' && hash);
      const pageIsKnown = hashes.length > 0 && hashes.every((hash) => indexedTxs.has(hash));
      if (!fullSweep && pageIsKnown) break;
      if (page.length < ACCOUNT_PAGE_SIZE) break;
      const heights = page.map((entry) => asNumber(entry?.tx_block_height)).filter((height) => height !== null);
      if (!heights.length) break;
      const nextMaxBlockHeight = Math.min(...heights) - 1;
      if (maxBlockHeight !== null && nextMaxBlockHeight >= maxBlockHeight) break;
      maxBlockHeight = nextMaxBlockHeight;
    }
    return entries;
  }

  function sortOldest(records) {
    return [...records].sort((a, b) =>
      (asNumber(a?.tx_block_height, Number.MAX_SAFE_INTEGER) - asNumber(b?.tx_block_height, Number.MAX_SAFE_INTEGER)) ||
      (String(a?.tx_block_timestamp ?? '').localeCompare(String(b?.tx_block_timestamp ?? ''))) ||
      String(a?.transaction_hash ?? '').localeCompare(String(b?.transaction_hash ?? '')),
    );
  }

  function dedupeAccountTransactions(entries) {
    const byHash = new Map();
    for (const entry of entries) {
      const hash = entry?.transaction_hash;
      if (typeof hash !== 'string' || !hash) continue;
      const existing = byHash.get(hash);
      const height = asNumber(entry?.tx_block_height);
      const existingHeight = asNumber(existing?.tx_block_height);
      if (!existing || (height !== null && (existingHeight === null || height < existingHeight))) {
        byHash.set(hash, entry);
      }
    }
    return [...byHash.values()];
  }

  async function processTransactions(entries, { reprocess = false } = {}) {
    const seen = new Set(indexedTxs);
    const newEntries = sortOldest(dedupeAccountTransactions(entries).filter((entry) => {
      const hash = entry?.transaction_hash;
      if (typeof hash !== 'string' || !hash || (!reprocess && seen.has(hash))) return false;
      if (seen.has(hash)) return true;
      seen.add(hash);
      return true;
    }));
    for (let offset = 0; offset < newEntries.length; offset += TRANSACTION_BATCH_SIZE) {
      const batch = newEntries.slice(offset, offset + TRANSACTION_BATCH_SIZE);
      const result = await fetchJson('/v0/transactions', { tx_hashes: batch.map((entry) => entry.transaction_hash) });
      const transactions = new Map((result?.transactions ?? []).map((item) => [
        item?.transaction?.hash,
        item,
      ]));
      for (const entry of batch) {
        const transaction = transactions.get(entry.transaction_hash);
        const events = parseEvents(transaction, settings.contractId, entry);
        const newEvents = [];
        let replacedEvent = false;
        for (const event of events) {
          const existed = indexes.has(event);
          if (indexes.add(event)) {
            if (existed) replacedEvent = true;
            else newEvents.push(event);
          }
        }
        if (replacedEvent) {
          const records = indexes.events({ limit: Number.MAX_SAFE_INTEGER });
          await writeFile(eventsPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
        } else if (newEvents.length) {
          await appendFile(eventsPath, `${newEvents.map((event) => JSON.stringify(event)).join('\n')}\n`);
        }
        indexedTxs.add(entry.transaction_hash);
        await persistIndexedTxs();
      }
    }
  }

  async function syncOnce() {
    await initialize();
    const currentTime = now();
    const gap = state.txsTotal === null ? 0 : Math.max(0, state.txsTotal - indexedTxs.size);
    const sweepDue = !initialPollDone || state.lastSweepAt === null || currentTime - Date.parse(state.lastSweepAt) >= settings.sweepMs;
    const fullSweep = sweepDue || gap > 0;
    const entries = fullSweep
      ? await collectAccountTransactions({ fullSweep: true })
      : await collectAccountTransactions();
    await processTransactions(entries, { reprocess: initialPollDone && sweepDue });
    initialPollDone = true;
    state.lastPollAt = new Date(currentTime).toISOString();
    if (fullSweep) state.lastSweepAt = state.lastPollAt;
    state.lastError = null;
    return state;
  }

  async function follow() {
    if (!settings.enabled || running) return;
    running = true;
    try {
      await initialize();
      while (settings.enabled) {
        try { await syncOnce(); } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error);
          logger.error?.(`tide indexer error: ${state.lastError}`);
        }
        await sleep(settings.pollMs);
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.error?.(`tide indexer error: ${state.lastError}`);
    } finally {
      running = false;
    }
  }

  return {
    state,
    initialize,
    syncOnce,
    start: () => { void follow(); },
    stop: () => { settings.enabled = false; state.enabled = false; },
    status: () => ({
      enabled: state.enabled,
      source: 'fastnear',
      txsSeen: indexedTxs.size,
      processedHashes: indexedTxs.size,
      txsTotal: state.txsTotal,
      gap: state.txsTotal === null ? null : Math.max(0, state.txsTotal - indexedTxs.size),
      lastPollAt: state.lastPollAt,
      lastSweepAt: state.lastSweepAt,
      events: indexes.count(),
      lastError: state.lastError,
    }),
    events: (query) => indexes.events(query),
    boatHistory: (account) => indexes.boatHistory(account),
    assemblies: (limit, active) => indexes.assemblies(limit, active),
    leaderboard: (by) => indexes.leaderboard(by),
    generations: (limit) => indexes.generations(limit),
    parseEvents,
  };
}

export { parseEvents };
