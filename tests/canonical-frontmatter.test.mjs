import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('alternate content root: comment-prefixed title is rendered once and metadata survives', () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-docs-'));
  try {
    const file = join(root, 'index.md');
    writeFileSync(
      file,
      '---\npage_title: "old"\nxcsh_docs: {"id":"canonical","role":"reference"}\n---\n\n<!-- first\ncomment -->\n<!-- second -->\n\n# Reference\n\n```terraform\n# code comment\n```\n',
    );
    execFileSync(process.execPath, ['docker/normalize-frontmatter.mjs', root]);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /title: "Reference"/);
    assert.doesNotMatch(text, /^# Reference$/m);
    assert.match(text, /# code comment/);
    assert.match(text, /"role":"reference"/);
    execFileSync(process.execPath, ['docker/normalize-frontmatter.mjs', root]);
    assert.equal(readFileSync(file, 'utf8'), text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fenced H1 is never promoted', () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-docs-'));
  try {
    writeFileSync(
      join(root, 'fence.md'),
      '---\npage_title: "Example"\n---\n<!-- comment -->\n~~~terraform\n# Not a title\n~~~\n',
    );
    execFileSync(process.execPath, ['docker/normalize-frontmatter.mjs', root]);
    assert.match(readFileSync(join(root, 'fence.md'), 'utf8'), /title: "Example"/);
    assert.match(readFileSync(join(root, 'fence.md'), 'utf8'), /# Not a title/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
