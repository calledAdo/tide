export type UnitValue = string | number | bigint;

export const TIDE_DECIMALS = 18;
export const NEAR_DECIMALS = 24;

export function unitsToNumber(value: UnitValue, decimals: number): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(number)) return 0;
  return number / 10 ** decimals;
}

export function formatUnits(
  value: UnitValue,
  decimals: number,
  maximumFractionDigits: number,
): string {
  const number = unitsToNumber(value, decimals);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('en-US', { maximumFractionDigits });
}

export function formatTide(value: UnitValue): string {
  return `${formatUnits(value, TIDE_DECIMALS, 2)} TIDE`;
}

export function formatTideAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatNear(value: UnitValue): string {
  return `${formatUnits(value, NEAR_DECIMALS, 3)} NEAR`;
}

export function compactNumber(value: UnitValue): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (Math.abs(number) >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(2)}M`;
  }
  return Math.round(number).toLocaleString('en-US');
}
