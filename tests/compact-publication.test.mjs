import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compactPublication } from '../docker/compact-publication.mjs';

test('compact generated receipts and token aliases without altering content or destinations', () => {
  const root = mkdtempSync(join(tmpdir(), 'compact-publication-'));
  try {
    const html =
      '<html><head></head><body><pre><code><span class="t1234567890">a &lt; b t1234567890</span></code></pre><a id="section" href="/deep/#leaf">Link</a></body></html>';
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'tokens.css'), '.t1234567890{color:red}');
    writeFileSync(
      join(root, 'llms-hierarchy-receipt.json'),
      JSON.stringify({ pages: 1, details: 'x'.repeat(1000) }, null, 2),
    );
    writeFileSync(
      join(root, 'rendered-artifact-receipt.json'),
      JSON.stringify(
        { transformed: { 'index.html': {} }, llms_hierarchy: { pages: 1, details: 'x'.repeat(1000) } },
        null,
        2,
      ),
    );
    const r = compactPublication(root);
    assert.ok(r.savedBytes > 0);
    const after = readFileSync(join(root, 'index.html'), 'utf8');
    assert.equal(after.replace(/class="[^"]+"/g, ''), html.replace(/class="[^"]+"/g, ''));
    assert.match(readFileSync(join(root, 'tokens.css'), 'utf8'), /\.z0\{/);
    const receipt = JSON.parse(readFileSync(join(root, 'rendered-artifact-receipt.json')));
    assert.equal(receipt.llms_hierarchy.path, 'llms-hierarchy-receipt.json');
    assert.match(receipt.llms_hierarchy.sha256, /^sha256:/);
    assert.ok(receipt.transformed['index.html'].bytes > 0);
    assert.equal(compactPublication(root).savedBytes, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
