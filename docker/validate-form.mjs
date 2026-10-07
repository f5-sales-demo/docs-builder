import fs from 'node:fs';
import { resolveManifest } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(new URL('../src/data/legacy-fields.json', import.meta.url), 'utf8'));
const aliases = Object.assign(
  {},
  ...Object.values(legacy).map((fields) =>
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.name])),
  ),
);
resolveManifest(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), catalog, aliases);
