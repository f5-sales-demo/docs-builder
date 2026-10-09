import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function validate(source, script = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statistics-authoring-'));
  try {
    fs.mkdirSync(path.join(root, 'en'));
    fs.mkdirSync(path.join(root, 'assets/scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'en/origin-performance.mdx'), source);
    fs.writeFileSync(path.join(root, 'assets/scripts/example.sh'), script);
    const manifest = path.join(root, 'placeholders.json');
    fs.writeFileSync(manifest, JSON.stringify({ version: 2, fields: ['XCSH_NAMESPACE', 'XCSH_API_TOKEN'] }));
    return spawnSync(process.execPath, ['docker/validate-form.mjs', manifest, root, 'statistics'], {
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(root, { recursive: true });
  }
}
test('Statistics rejects discovered identifiers declared as configuration with location', () => {
  const result = validate(
    '<div data-xcsh-context="shell" data-xcsh-fields="XCSH_ORIGIN_POOL">\n\n```bash\nprintf "%s" "$XCSH_ORIGIN_POOL"\n```\n</div>',
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin-performance\.mdx.*block 1.*XCSH_ORIGIN_POOL/s);
});
test('Statistics rejects unpersonalized inputs and missing script dependencies', () => {
  for (const [attributes, code] of [
    ['data-xcsh-render="inline" data-xcsh-fields="XCSH_NAMESPACE"', 'printf "%s" "$XCSH_NAMESPACE"'],
    ['data-xcsh-render="script" data-xcsh-fields=""', 'file=../assets/scripts/example.sh'],
  ]) {
    const source = `<div data-xcsh-context="shell" ${attributes}>\n\n\`\`\`bash${code.startsWith('file=') ? ' ' + code : '\n' + code}\n\`\`\`\n</div>`;
    const result = validate(source, '#!/usr/bin/env bash\nprintf "%s" "$XCSH_NAMESPACE"\n');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /origin-performance\.mdx.*block 1/s);
  }
});
test('Statistics preserves discovery and calculated variables', () => {
  const source =
    '<div data-xcsh-context="shell" data-xcsh-render="inline" data-xcsh-fields="XCSH_NAMESPACE">\n\n```bash\nprintf "%s" "<XCSH_NAMESPACE>" "$XCSH_ORIGIN_POOL" "$((XCSH_END_TIME-1))" "$(date)"\n```\n</div>';
  const result = validate(source);
  assert.equal(result.status, 0, result.stderr);
});

test('canonical script payload preserves unicode and final newline byte for byte', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-source-'));
  try {
    const source = '#!/bin/bash\nprintf "café\\n"\n';
    fs.writeFileSync(path.join(root, 'example.sh'), source);
    fs.writeFileSync(path.join(root, 'page.html'), '<div data-xcsh-source-file="example.sh"></div>');
    const result = spawnSync(process.execPath, ['docker/canonical-script-source.mjs', root, root], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = fs.readFileSync(path.join(root, 'page.html'), 'utf8').match(/data-xcsh-source=\"([^\"]+)\"/)[1];
    assert.equal(Buffer.from(payload, 'base64').toString('utf8'), source);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
