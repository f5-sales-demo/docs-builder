#!/usr/bin/env node
// Normalize ingested Markdown frontmatter for Starlight rendering.
//
// Source docs (e.g. tfplugindocs output) follow the Terraform convention where
// `page_title` is the browser-tab title and the body's first `# H1` is the visible
// heading. Starlight instead renders the frontmatter `title` as the page `<h1>` and
// expects NO top-level H1 in the body. Feeding Terraform-style docs to Starlight
// therefore renders the title twice (once from frontmatter, once from the body H1).
//
// This script reconciles the two conventions, choosing the body H1 as the single
// source of truth: it promotes the first body H1 to the frontmatter `title` and
// removes that H1 from the body. Pages without a body H1 keep today's behavior
// (rename a lone `page_title` to `title`); pages that need no change are left
// byte-identical.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: normalize-frontmatter.mjs <content-root>');
  process.exit(2);
}
if (!existsSync(root)) {
  console.log(`normalize-frontmatter: content root ${root} not found — nothing to do`);
  process.exit(0);
}

// YAML double-quoted scalar: only backslash and double-quote need escaping.
const yamlQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const isFrontmatterFence = (line) => line.trim() === '---';
const H1_RE = /^#[ \t]+(.+?)[ \t]*$/;

// Split a file into its frontmatter lines (without the `---` fences) and body lines.
// Returns { fm: string[] | null, body: string[] }. `fm` is null when no frontmatter.
function split(lines) {
  if (lines.length === 0 || !isFrontmatterFence(lines[0])) {
    return { fm: null, body: lines };
  }
  for (let i = 1; i < lines.length; i++) {
    if (isFrontmatterFence(lines[i])) {
      return { fm: lines.slice(1, i), body: lines.slice(i + 1) };
    }
  }
  // Unterminated frontmatter — treat the whole file as body, leave untouched.
  return { fm: null, body: lines };
}

// The title H1 is the first non-blank body line, and only when it is an H1.
// Restricting to the first non-blank line keeps us from stripping section headings
// or `#` comments inside fenced code blocks deeper in the document.
function findTitleH1(body) {
  for (let i = 0; i < body.length; i++) {
    if (body[i].trim() === '') continue;
    const m = body[i].match(H1_RE);
    return m ? { index: i, text: m[1] } : null;
  }
  return null;
}

// Drop a single leading H1 line plus at most one blank line that follows it.
function stripH1(body, index) {
  const out = body.slice();
  out.splice(index, 1);
  if (out[index] !== undefined && out[index].trim() === '') {
    out.splice(index, 1);
  }
  return out;
}

// Process one file's text; return new text, or null if no change is needed.
function normalize(text) {
  const trailingNewline = text.endsWith('\n');
  const lines = text.replace(/\n$/, '').split('\n');
  const { fm, body } = split(lines);
  const h1 = findTitleH1(body);

  if (h1) {
    // H1 wins: it becomes the frontmatter title and is removed from the body.
    const keptFm = (fm ?? []).filter((l) => !/^(title|page_title):/.test(l));
    const newFm = [`title: ${yamlQuote(h1.text)}`, ...keptFm];
    const newBody = stripH1(body, h1.index);
    // Leading blanks are absorbed into the single separator below.
    while (newBody.length && newBody[0].trim() === '') newBody.shift();
    const out = ['---', ...newFm, '---', '', ...newBody].join('\n');
    return trailingNewline ? `${out}\n` : out;
  }

  // No body H1. Only act if a lone `page_title` needs renaming to `title`.
  if (fm?.some((l) => /^page_title:/.test(l)) && !fm.some((l) => /^title:/.test(l))) {
    const newFm = fm.map((l) => l.replace(/^page_title:/, 'title:'));
    const out = ['---', ...newFm, '---', ...body].join('\n');
    return trailingNewline ? `${out}\n` : out;
  }

  return null;
}

let changed = 0;
const entries = readdirSync(root, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (!/\.mdx?$/.test(entry.name)) continue;
  const path = join(entry.parentPath ?? entry.path, entry.name);
  const next = normalize(readFileSync(path, 'utf8'));
  if (next !== null) {
    writeFileSync(path, next);
    changed++;
  }
}
console.log(`normalize-frontmatter: updated ${changed} file(s) under ${root}`);
