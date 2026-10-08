import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const { validateSharedTree, prepareSharedPublication, verifySharedOutput } = await import(
  '../docker/shared-publication.mjs'
);
const tree = path.resolve('../f5-sales-demo.github.io/shared');
test('publisher validates retained manifest references and asset hashes', async () => {
  assert.equal((await validateSharedTree(tree)).contract, 'v1');
});
test('only root can mount shared assets and consumers reject a copy', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'shared-publication-'));
  try {
    assert.equal(await prepareSharedPublication('f5-sales-demo/f5-sales-demo.github.io', tree, temp), 'publish');
    await assert.rejects(() => prepareSharedPublication('f5-sales-demo/canada', tree, temp));
    const pointer = JSON.parse(await readFile(path.join(temp, 'shared/v1/current.json')));
    pointer.contract = 'v2';
    await writeFile(path.join(temp, 'shared/v1/current.json'), JSON.stringify(pointer));
    await assert.rejects(() => validateSharedTree(path.join(temp, 'shared')));
  } finally {
    await rm(temp, { recursive: true });
  }
});
test('fails closed for corrupted retained assets', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'shared-corrupt-'));
  try {
    await cp(tree, temp, { recursive: true });
    const pointer = JSON.parse(await readFile(path.join(temp, 'v1/current.json')));
    const manifest = JSON.parse(await readFile(path.join(temp, 'v1/releases', `${pointer.release.sha256}.json`)));
    await writeFile(path.join(temp, 'assets', manifest.assets.runtime.url.split('/').at(-1)), 'broken');
    await assert.rejects(() => validateSharedTree(temp));
  } finally {
    await rm(temp, { recursive: true });
  }
});
