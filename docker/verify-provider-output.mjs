import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: verify-provider-output.mjs <documentation> <output>');
const index = JSON.parse(readFileSync(join(source, 'terraform-llms-index.json')));
const documents = new Map();
const manifest = JSON.parse(readFileSync(join(source, 'generated-manifest.json')));
for (const file of Object.keys(manifest.files)) {
  if (!file.startsWith('documentation/') || !file.endsWith('.md') || file.includes('/_data/')) continue;
  const name = file.slice('documentation/'.length);
  const line = readFileSync(join(source, name), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('xcsh_docs: '));
  if (line)
    documents.set(
      JSON.parse(line.slice(11)).id,
      name
        .replace(/(^|\/)index\.md$/, '')
        .replace(/\.md$/, '')
        .replace(/\/$/, ''),
    );
}
let count = 0;
const destinations = new Map();
for (const collection of index.collections) {
  for (const [property, destination] of Object.entries(collection.properties)) {
    const route = documents.get(destination.document_id);
    if (route === undefined) throw new Error(`Missing canonical property document: ${property}`);
    const anchors = destinations.get(route) || [];
    anchors.push(destination.anchor);
    destinations.set(route, anchors);
  }
}
for (const [route, anchors] of destinations) {
  const html = readFileSync(join(output, route, 'index.html'), 'utf8');
  for (const anchor of anchors) {
    if (!html.includes(`id="${anchor}"`)) throw new Error(`Missing property fragment: ${route}#${anchor}`);
    count++;
  }
}
console.log(`Verified ${count} exact property destinations across ${destinations.size} Astro routes.`);
