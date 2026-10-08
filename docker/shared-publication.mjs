import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const theme = process.env.DOCS_THEME_PATH || resolve('node_modules/@f5-sales-demo/docs-theme');
const { sharedMode } = await import(pathToFileURL(join(theme, 'src/shared/settings.mjs')));
const { ROOT, validatePointer, validateManifest, validateData } = await import(
  pathToFileURL(join(theme, 'src/shared/contract.mjs'))
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function validateSharedTree(tree) {
  const pointer = validatePointer(JSON.parse(await readFile(join(tree, 'v1/current.json'))));
  const files = await readdir(tree, { recursive: true });
  for (const file of files) {
    const path = join(tree, file);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Shared tree contains a symbolic link');
    if (!stat.isFile()) continue;
    if (/^[a-f0-9]{64}\./.test(file.split('/').at(-1))) {
      if (digest(await readFile(path)) !== file.split('/').at(-1).split('.')[0])
        throw new Error('Shared tree has an invalid immutable hash');
    } else if (file !== 'v1/current.json') throw new Error('Unexpected file in shared publication tree');
  }
  const selected = await readFile(join(tree, 'v1/releases', `${pointer.release.sha256}.json`));
  if (selected.length !== pointer.release.bytes || digest(selected) !== pointer.release.sha256)
    throw new Error('Shared pointer integrity mismatch');
  for (const file of files.filter((file) => file.startsWith('v1/releases/') && file.endsWith('.json'))) {
    const manifest = validateManifest(JSON.parse(await readFile(join(tree, file))));
    for (const asset of Object.values(manifest.assets)) {
      const bytes = await readFile(join(tree, 'assets', asset.url.split('/').at(-1)));
      if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256)
        throw new Error('Shared asset reference integrity mismatch');
      if (asset === manifest.assets.data) validateData(JSON.parse(bytes));
    }
  }
  return pointer;
}
export async function prepareSharedPublication(repository, source, publicDir) {
  const mode = sharedMode(repository);
  if (mode === 'publish') {
    if (!source) throw new Error('Root publishing requires SHARED_ASSETS_DIR');
    await validateSharedTree(source);
    await mkdir(publicDir, { recursive: true });
    await cp(source, join(publicDir, 'shared'), { recursive: true, errorOnExist: true, force: false });
  } else if (source) throw new Error('Downstream consumers cannot copy shared shell assets');
  return mode;
}
export async function verifySharedOutput(repository, output) {
  const mode = sharedMode(repository);
  if (mode === 'local') return;
  const files = await readdir(output, { recursive: true });
  if (mode === 'consume' && files.some((file) => file.startsWith('shared/')))
    throw new Error('Consumer copied the centralized shell');
  let pages = 0,
    localAssetBytes = 0;
  for (const file of files) {
    const path = join(output, file);
    if (!(await lstat(path)).isFile()) continue;
    if (file.startsWith('_astro/') || file.startsWith('_shared/')) localAssetBytes += (await lstat(path)).size;
    if (file.endsWith('.html')) {
      const html = await readFile(path, 'utf8');
      if (/http-equiv=["']refresh/i.test(html)) continue;
      if (!html.includes('data-f5-shared-consumer') || !html.includes(`${ROOT}assets/`))
        throw new Error(`Missing shared consumer: ${file}`);
      if (/<astro-island[^>]*component-url="[^"]*(?:MegaMenu|SharedMegaMenu)/.test(html))
        throw new Error('Embedded global menu island');
      pages++;
    }
    if (file.startsWith('_astro/') && /\.(css|js|woff2)$/.test(file)) {
      if (file.endsWith('.woff2')) throw new Error('Duplicated shared font');
      const body = await readFile(path, 'utf8');
      if (
        body.includes('.smm-panel{') ||
        body.includes('.smm-panel {') ||
        body.includes('neusaNextProWide') ||
        body.includes('Deploy an application security demo with Terraform')
      )
        throw new Error(`Duplicated owned shell in ${file}`);
    }
  }
  const receipt = {
    contract: 'v1',
    mode,
    repository,
    pages,
    localAssetBytes,
    activeManifest: `${ROOT}v1/current.json`,
  };
  await writeFile(join(output, 'shared-shell-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [command, repository, source, target] = process.argv.slice(2);
  if (command === 'prepare') console.log(await prepareSharedPublication(repository, source || undefined, target));
  else if (command === 'verify') console.log(await verifySharedOutput(repository, source));
  else throw new Error('usage: shared-publication.mjs prepare|verify <repository> <source/output> [public]');
}
