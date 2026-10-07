import fs from 'node:fs';
import { resolveManifest } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url), 'utf8'));
resolveManifest(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), catalog);
