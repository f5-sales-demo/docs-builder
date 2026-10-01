import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'vendor/npm/manifest.json'), 'utf8'));
for (const artifact of manifest.artifacts) {
  const entry = lock.packages[`node_modules/${artifact.name}`];
  if (!entry || entry.version !== artifact.version || entry.integrity !== artifact.integrity) {
    throw new Error(`Cached artifact disagrees with lockfile: ${artifact.name}`);
  }
  const file = realpathSync(resolve(root, 'vendor/npm', artifact.file));
  const bytes = readFileSync(file);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== entry.integrity) throw new Error(`Cached artifact integrity mismatch: ${artifact.name}`);
  // Invoke npm's JS entrypoint directly: no shell or Windows .cmd quoting needed.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this script through npm run cache:seed');
  execFileSync(process.execPath, [npmCli, 'cache', 'add', file, '--offline'], { stdio: 'inherit' });
  console.log(`Cached verified ${artifact.name}@${artifact.version} (${bytes.length} bytes)`);
}
