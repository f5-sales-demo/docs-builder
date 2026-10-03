import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
export function compactPublication(root) {
  const files = readdirSync(root, { recursive: true }).filter((f) => /\.(html|css|js)$/.test(f));
  const tokens = new Set();
  for (const f of files) {
    const t = readFileSync(join(root, f), 'utf8');
    for (const m of t.matchAll(/class="(t[a-f0-9]{10})"/g)) tokens.add(m[1]);
  }
  const aliases = new Map([...tokens].sort().map((t, i) => [t, `z${i.toString(36)}`]));
  let savedBytes = 0;
  for (const f of files) {
    const path = join(root, f);
    const before = readFileSync(path, 'utf8');
    const after = f.endsWith('.html')
      ? before.replace(/class="(t[a-f0-9]{10})"/g, (original, t) =>
          aliases.has(t) ? `class="${aliases.get(t)}"` : original,
        )
      : f.endsWith('tokens.css')
        ? before.replace(/\.(t[a-f0-9]{10})(?=\{)/g, (original, t) =>
            aliases.has(t) ? `.${aliases.get(t)}` : original,
          )
        : before;
    savedBytes += Buffer.byteLength(before) - Buffer.byteLength(after);
    if (after !== before) writeFileSync(path, after);
  }
  const hierarchyPath = join(root, 'llms-hierarchy-receipt.json');
  if (existsSync(hierarchyPath)) {
    const before = readFileSync(hierarchyPath);
    const after = Buffer.from(JSON.stringify(JSON.parse(before)) + '\n');
    savedBytes += before.length - after.length;
    writeFileSync(hierarchyPath, after);
  }
  const receiptPath = join(root, 'rendered-artifact-receipt.json');
  if (existsSync(receiptPath)) {
    const before = readFileSync(receiptPath);
    const receipt = JSON.parse(before);
    for (const f of Object.keys(receipt.transformed || {})) {
      const data = readFileSync(join(root, f));
      receipt.transformed[f] = { bytes: data.length, sha256: sha(data) };
    }
    if (existsSync(hierarchyPath))
      receipt.llms_hierarchy = { path: 'llms-hierarchy-receipt.json', sha256: sha(readFileSync(hierarchyPath)) };
    const after = Buffer.from(JSON.stringify(receipt) + '\n');
    savedBytes += before.length - after.length;
    writeFileSync(receiptPath, after);
  }
  return { savedBytes, tokenAliases: aliases.size };
}
if (process.argv[1]?.endsWith('compact-publication.mjs'))
  console.log(JSON.stringify(compactPublication(process.argv[2])));
