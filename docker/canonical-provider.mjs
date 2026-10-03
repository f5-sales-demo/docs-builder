import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [mode, source, target] = process.argv.slice(2);
if (!['stage', 'receipt'].includes(mode) || !source || !target)
  throw new Error('usage: canonical-provider.mjs stage|receipt <source> <target>');
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = resolve(source);
const manifestBytes = readFileSync(join(root, 'generated-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const base = (process.env.DOCS_BASE || '/terraform-provider-xcsh/').replace(/\/$/, '');
const sourceBase = 'https://f5-sales-demo.github.io/terraform-provider-xcsh';
const pages = [];
const slugs = new Set();
for (const [path, evidence] of Object.entries(manifest.files)) {
  if (!path.startsWith('documentation/')) continue;
  const name = path.slice('documentation/'.length);
  if (name.split('/').some((part) => part === '..') || name.startsWith('/'))
    throw new Error(`Unsafe manifest path: ${name}`);
  const bytes = readFileSync(join(root, name));
  if (bytes.length !== evidence.bytes || hash(bytes) !== evidence.sha256)
    throw new Error(`Canonical source receipt mismatch: ${name}`);
  if (!name.endsWith('.md') || name.startsWith('_data/')) continue;
  const slug = name
    .replace(/(^|\/)index\.md$/, '')
    .replace(/\.md$/, '')
    .replace(/\/$/, '');
  if (slugs.has(slug)) throw new Error(`Duplicate canonical route: ${slug}`);
  slugs.add(slug);
  const text = bytes.toString('utf8');
  const metaLine = text.split('\n').find((line) => line.startsWith('xcsh_docs: '));
  const metadata = metaLine ? JSON.parse(metaLine.slice(11)) : null;
  const titleLine = text.split('\n').find((line) => line.startsWith('page_title: ') || line.startsWith('title: '));
  const title = titleLine ? JSON.parse(titleLine.slice(titleLine.indexOf(':') + 1)) : name;
  pages.push({
    name,
    slug,
    title,
    id: metadata?.id,
    collection_id: metadata?.collection_id,
    parent_id: metadata?.parent_id,
    role: metadata?.role,
  });
  if (mode === 'stage') {
    const destination = join(target, name);
    mkdirSync(dirname(destination), { recursive: true });
    // Only temporary inputs are rewritten. Keep original source receipts separately.
    writeFileSync(
      destination,
      manifest.publication_prefix
        ? text
        : text.replaceAll(`${sourceBase}/`, `${process.env.DOCS_SITE || 'https://f5-sales-demo.github.io'}${base}/`),
    );
  }
}
const sections = [
  ['guides', 'Guides'],
  ['resources', 'Resources'],
  ['data-sources', 'Data sources'],
  ['actions', 'Actions'],
  ['ephemeral-resources', 'Ephemeral resources'],
];
const landingPages = sections.filter(([slug]) => !slugs.has(slug));
if (mode === 'stage') {
  for (const [slug, title] of landingPages) {
    const links = pages.filter(
      (page) => page.slug.startsWith(`${slug}/`) && (!page.role || page.role === 'fundamentals'),
    );
    const destination = join(target, slug, 'index.md');
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      `---\ntitle: ${JSON.stringify(title)}\n---\n\n` +
        links.map((page) => `- [${page.title}](${base}/${page.slug}/)`).join('\n') +
        '\n',
    );
  }
  const collections = {};
  for (const page of pages) {
    if (!page.collection_id) continue;
    collections[page.collection_id] ||= [];
    collections[page.collection_id].push(page);
  }
  const navigation = { base, version: process.env.DOCUMENTATION_LABEL || 'Latest stable', collections };
  writeFileSync(process.env.PROVIDER_NAVIGATION, JSON.stringify(navigation));
  mkdirSync('/app/public', { recursive: true });
  for (const asset of ['_data', 'llms.txt', 'terraform-llms-index.json', 'generated-manifest.json']) {
    cpSync(join(root, asset), join('/app/public', asset), { recursive: true });
  }
} else {
  const transformed = {};
  for (const page of [...pages, ...landingPages.map(([slug]) => ({ slug }))]) {
    const output = join(target, page.slug, 'index.html');
    if (!existsSync(output)) throw new Error(`Missing Astro route: ${page.slug}`);
    const bytes = readFileSync(output);
    transformed[relative(target, output)] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const redirect = join(target, 'en/index.html');
  const redirectHtml = readFileSync(redirect, 'utf8');
  if (!redirectHtml.includes(`content="0;url=${base}/"`))
    throw new Error('English entry redirect does not target this publication root');
  const redirectBytes = readFileSync(redirect);
  transformed['en/index.html'] = { bytes: redirectBytes.length, sha256: hash(redirectBytes) };
  const html = readdirSync(target, { recursive: true }).filter(
    (name) => name.endsWith('.html') && name !== '404.html' && name !== 'en/index.html',
  );
  if (html.length !== pages.length + landingPages.length)
    throw new Error(`Unexpected HTML route count: ${html.length} != ${pages.length + landingPages.length}`);
  writeFileSync(
    join(target, 'rendered-artifact-receipt.json'),
    JSON.stringify(
      {
        schema_version: 1,
        source_commit: manifest.source_commit || process.env.DOCUMENTATION_SOURCE_COMMIT,
        builder_digest: process.env.BUILDER_DIGEST,
        theme_version: JSON.parse(readFileSync('/app/node_modules/@f5-sales-demo/docs-theme/package.json')).version,
        base,
        route_count: pages.length + landingPages.length,
        canonical_route_count: pages.length,
        redirect_route_count: 1,
        source_manifest_sha256: hash(manifestBytes),
        transformed,
        llms_hierarchy: existsSync(join(target, 'llms-hierarchy-receipt.json'))
          ? JSON.parse(readFileSync(join(target, 'llms-hierarchy-receipt.json')))
          : undefined,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(`canonical-provider: ${mode} verified ${pages.length} routes`);
