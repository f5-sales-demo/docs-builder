import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('rejects altered source before staging', () => {
  const root = mkdtempSync(join(tmpdir(), 'provider-source-'));
  try {
    writeFileSync(
      join(root, 'generated-manifest.json'),
      JSON.stringify({ files: { 'documentation/index.md': { bytes: 1, sha256: 'sha256:invalid' } } }),
    );
    writeFileSync(join(root, 'index.md'), 'changed');
    assert.throws(
      () =>
        execFileSync(process.execPath, ['docker/canonical-provider.mjs', 'stage', root, join(root, 'target')], {
          stdio: 'pipe',
        }),
      /Canonical source receipt mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects manifest traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'provider-source-'));
  try {
    writeFileSync(
      join(root, 'generated-manifest.json'),
      JSON.stringify({ files: { 'documentation/../outside.md': {} } }),
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, ['docker/canonical-provider.mjs', 'stage', root, join(root, 'target')], {
          stdio: 'pipe',
        }),
      /Unsafe manifest path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
