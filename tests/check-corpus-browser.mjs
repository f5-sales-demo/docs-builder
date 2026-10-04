import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const [output, manifestPath] = process.argv.slice(2);
assert(output && manifestPath, 'usage: check-corpus-browser.mjs OUTPUT MANIFEST');
const html = readFileSync(`${output}/index.html`, 'utf8');
const data = html.match(/<script type="application\/json" data-browser-data[^>]*>(.*?)<\/script>/s)?.[1];
assert(data, 'browser graph must be embedded in the landing page');
const graph = JSON.parse(data);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(graph.nodes.filter((node) => node.type === 'leaf').length, manifest.documents.length);
assert.equal(graph.sources.length, Object.keys(manifest.source_roots).length);
for (const node of graph.nodes) {
  assert(existsSync(`${output}/_llms-txt/${node.route}.txt`), node.route);
  assert(!/^(?:Published|Last modified)/.test(node.description), node.route);
  assert(!/[\u200B-\u200D\uFEFF]/.test(node.description), node.route);
  assert(/[\p{Letter}\p{Number}]/u.test(node.description), node.route);
  for (const child of node.children)
    assert(
      graph.nodes.some((node) => node.route === child),
      child,
    );
}
console.log(`Verified ${graph.nodes.length} browser nodes and ${manifest.documents.length} Markdown destinations`);
