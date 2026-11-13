import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function emptyState(day) {
  return { day, total: 0, accounts: {}, ips: {} };
}

function rolloverState(state, now) {
  const accounts = {};
  for (const [accountId, timestamp] of Object.entries(state.accounts ?? {})) {
    if (now - Number(timestamp) < DAY_MS) accounts[accountId] = Number(timestamp);
  }
  const ips = {};
  for (const [ip, timestamps] of Object.entries(state.ips ?? {})) {
    const active = Array.isArray(timestamps) ? timestamps.filter((timestamp) => now - Number(timestamp) < DAY_MS).map(Number) : [];
    if (active.length > 0) ips[ip] = active;
  }
  return { day: utcDay(now), total: 0, accounts, ips };
}

export class FileRateLimiter {
  constructor(dataDir, { now = () => Date.now(), fileName = 'onboard-rate-limit.json' } = {}) {
    this.dataDir = dataDir;
    this.path = join(dataDir, fileName);
    this.now = now;
    this.queue = Promise.resolve();
  }

  async readState(now = this.now()) {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      if (state.day !== utcDay(now)) return rolloverState(state, now);
      return {
        day: state.day,
        total: Number.isInteger(state.total) ? state.total : 0,
        accounts: state.accounts && typeof state.accounts === 'object' ? state.accounts : {},
        ips: state.ips && typeof state.ips === 'object' ? state.ips : {},
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return emptyState(utcDay(now));
      throw error;
    }
  }

  async writeState(state) {
    const tempPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(state), { mode: 0o600 });
    await rename(tempPath, this.path);
  }

  async consume({ accountId, ip, dailyCap, now = this.now() }) {
    const operation = this.queue.then(async () => {
      const state = await this.readState(now);
      const hasAccount = Object.prototype.hasOwnProperty.call(state.accounts, accountId);
      const accountTime = Number(state.accounts[accountId] ?? 0);
      const ipTimes = Array.isArray(state.ips[ip]) ? state.ips[ip].filter((time) => now - time < DAY_MS) : [];
      if (hasAccount && now - accountTime < DAY_MS) return { allowed: false, reason: 'This account can be funded once every 24 hours.' };
      if (ipTimes.length >= 5) return { allowed: false, reason: 'This client IP has reached the 5-account daily limit.' };
      if (state.total >= dailyCap) return { allowed: false, reason: 'The daily onboarding cap has been reached. Try again tomorrow.' };

      state.accounts[accountId] = now;
      state.ips[ip] = [...ipTimes, now];
      state.total += 1;
      await this.writeState(state);
      return { allowed: true, onboardedToday: state.total };
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async countToday(now = this.now()) {
    const state = await this.readState(now);
    return state.total;
  }
}

export { DAY_MS };
