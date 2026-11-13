import { API_BASE } from '../config';

function accountFrom(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  for (const key of ['account', 'account_id', 'id', 'name']) {
    if (typeof item[key] === 'string') return item[key] as string;
  }
  return null;
}

export async function readBotAccounts(): Promise<Set<string>> {
  try {
    const response = await fetch(`${API_BASE}/bots/status`);
    if (!response.ok) return new Set();
    const body = await response.json() as unknown;
    const container = body && typeof body === 'object'
      ? body as Record<string, unknown>
      : {};
    const values = Array.isArray(body)
      ? body
      : container.bots ?? container.accounts ?? [];
    return new Set(
      (Array.isArray(values) ? values : [])
        .map(accountFrom)
        .filter((account): account is string => Boolean(account)),
    );
  } catch {
    return new Set();
  }
}
