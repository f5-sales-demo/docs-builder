import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corpusBrowserDescription } from '../src/scripts/corpus-browser-description.mjs';

test('remove exact leading capture dates from grounded descriptions', () => {
  const prose = 'Important: Configure TLS 1.3 before enabling the policy. Keep the expected HTTP 200 result.';
  assert.equal(
    corpusBrowserDescription(`\u200B Published April 5, 2023 | Last modified October 2, 2026 ${prose}`, 'Setup'),
    prose,
  );
  assert.equal(corpusBrowserDescription(`Updated 2026-11-16 ${prose}`, 'Setup'), prose);
});

test('remove invisible display characters without changing technical prose or attribution', () => {
  const prose = 'The upstream F5 guide requires TLS 1.3 and a limit of 100 requests. Do not reorder these actions.';
  assert.equal(
    corpusBrowserDescription(`\uFEFF${prose.slice(0, 12)}\u200B\u200C\u200D${prose.slice(12)}`, 'TLS'),
    prose,
  );
});

test('use a title-grounded description for invisible-only and date-only source values', () => {
  assert.equal(
    corpusBrowserDescription('\u200B\u200B\u200B', 'Platform concepts'),
    'Documentation for Platform concepts.',
  );
  assert.equal(
    corpusBrowserDescription('Published April 5, 2023 | Last modified October 2, 2026', 'Platform concepts'),
    'Documentation for Platform concepts.',
  );
  assert.equal(corpusBrowserDescription(undefined, 'Platform concepts'), 'Documentation for Platform concepts.');
});

test('preserve legitimate publication and modified-header prose', () => {
  for (const value of [
    'Published applications require authentication.',
    'Last modified headers control conditional requests.',
    'Use the Published April 5, 2023 API schema.',
    'Published April 32, 2023 is an invalid source date.',
  ]) {
    assert.equal(corpusBrowserDescription(value, 'Reference'), value);
  }
});

test('retain complete meaningful grounded descriptions', () => {
  const prose =
    `Configure the policy before starting the task. ${'The warning and expected result remain necessary. '.repeat(20)}`;
  assert.equal(corpusBrowserDescription(prose.trim(), 'Setup'), prose.trim());
});
