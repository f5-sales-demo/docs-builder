import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:cache');

test('portable cache seeds exact lockfile bytes and installs verified tarball offline', () => {
  const root = mkdtempSync(join(tmpdir(), 'npm cache with spaces '));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync(join(source, 'scripts/seed-npm-cache.mjs'), join(root, 'scripts/seed-npm-cache.mjs'));
    cpSync(join(source, 'vendor'), join(root, 'vendor'), { recursive: true });
    cpSync(join(source, 'package-lock.json'), join(root, 'package-lock.json'));
    const cache = join(root, 'cache');
    execFileSync(process.execPath, [join(root, 'scripts/seed-npm-cache.mjs')], {
      env: { ...process.env, npm_config_cache: cache },
      stdio: 'pipe',
    });
    const entry = JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages[
      'node_modules/@f5-sales-demo/docs-theme'
    ];
    const pacotePath = resolve(dirname(npmCli), '../node_modules/pacote');
    const script = `const pacote=require(${JSON.stringify(pacotePath)});pacote.tarball(${JSON.stringify(join(root, 'vendor/npm/docs-theme-4.4.10.tgz'))},{cache:${JSON.stringify(cache)},integrity:${JSON.stringify(entry.integrity)},offline:true}).then(b=>require('fs').writeFileSync(${JSON.stringify(join(root, 'offline.tgz'))},b));`;
    execFileSync(process.execPath, ['-e', script]);
    assert.deepEqual(
      readFileSync(join(root, 'offline.tgz')),
      readFileSync(join(root, 'vendor/npm/docs-theme-4.4.10.tgz')),
    );
    writeFileSync(join(root, 'vendor/npm/docs-theme-4.4.10.tgz'), 'altered');
    assert.throws(
      () => execFileSync(process.execPath, [join(root, 'scripts/seed-npm-cache.mjs')], { stdio: 'pipe' }),
      /integrity mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
