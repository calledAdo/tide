import { strict as assert } from 'node:assert';
import test from 'node:test';
import { compactNumber, formatNear, formatTide, unitsToNumber } from './format.ts';

test('converts yoctoNEAR with 24 decimals', () => {
  assert.equal(formatNear('495728921000000000000000'), '0.496 NEAR');
  assert.equal(unitsToNumber('495728921000000000000000', 24), 0.495728921);
});

test('keeps TIDE on its 18 decimal scale', () => {
  assert.equal(formatTide('22683000000000000000000'), '22,683 TIDE');
  assert.equal(formatTide('500000000000000000'), '0.5 TIDE');
});

test('formats full-effort catch token units as TIDE', () => {
  assert.equal(
    formatTide('41666666666666666666666'),
    '41,666.67 TIDE',
  );
});

test('uses full stock digits below one million', () => {
  assert.equal(compactNumber(999_999), '999,999');
  assert.equal(compactNumber(1_000_000), '1.00M');
});
