import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require(process.env.BRACES_PACKAGE || 'braces');
const CachePolicy = require(process.env.CACHE_POLICY_PACKAGE || 'http-cache-semantics');

test('brace APIs reject excessive nesting deliberately before recursive walkers', () => {
  const pattern = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
  for (const api of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.throws(
      () => api(pattern),
      (error) => error instanceof SyntaxError && /nesting depth/.test(error.message),
    );
  }
});
test('brace walkers reject deep or cyclic caller-supplied ASTs', () => {
  const root = { type: 'root', nodes: [] };
  let node = root;
  for (let i = 0; i < 10000; i++) {
    const next = { type: 'brace', nodes: [], parent: node };
    node.nodes.push(next);
    node = next;
  }
  for (const api of [braces.compile, braces.expand, braces.stringify]) assert.throws(() => api(root), /nesting depth/);
  const cyclic = { type: 'root', nodes: [] };
  cyclic.nodes.push(cyclic);
  assert.throws(() => braces.compile(cyclic), /cyclic/);
});
test('normal brace nesting, ranges, quoting and expansion remain compatible', () => {
  assert.deepEqual(braces.expand('a/{b,{c,d}}/{1..3}'), [
    'a/b/1',
    'a/b/2',
    'a/b/3',
    'a/c/1',
    'a/c/2',
    'a/c/3',
    'a/d/1',
    'a/d/2',
    'a/d/3',
  ]);
  assert.equal(braces.compile('a/{b,c}'), 'a/(b|c)');
  assert.equal(braces.stringify(braces.parse('a/{b,c}')), 'a/{b,c}');
  assert.deepEqual(braces.expand('"{literal}"'), ['{literal}']);
});
const req = (cacheControl = '') => ({
  url: 'https://example.com/item',
  method: 'GET',
  headers: { host: 'example.com', 'cache-control': cacheControl },
});
function policy(headers, options) {
  const p = new CachePolicy(req(), { status: 200, headers }, options);
  const now = p.now();
  p.now = () => now + 10000;
  return p;
}
test('max-stale cannot reuse security-zeroed cookies, private, no-store, no-cache or Vary star', () => {
  for (const headers of [
    { 'set-cookie': 'session=synthetic' },
    { 'cache-control': 'private, max-age=60' },
    { 'cache-control': 'no-store, max-age=60' },
    { 'cache-control': 'no-cache, max-age=60, stale-while-revalidate=120' },
    { vary: '*', 'cache-control': 'max-age=60' },
  ]) {
    const p = policy(headers);
    for (const directive of ['max-stale', 'max-stale=999999']) {
      assert.equal(p.satisfiesWithoutRevalidation(req(directive)), false, JSON.stringify(headers));
      assert.equal(p.evaluateRequest(req(directive)).response, undefined);
      const restored = CachePolicy.fromObject(p.toObject());
      restored.now = p.now;
      assert.equal(restored.satisfiesWithoutRevalidation(req(directive)), false);
    }
    assert.equal(p['useStaleWhileRevalidate'](), false);
  }
});
test('authenticated shared entries cannot bypass storage exclusions', () => {
  const original = { ...req(), headers: { ...req().headers, authorization: 'Bearer synthetic' } };
  const p = new CachePolicy(original, { status: 200, headers: { 'cache-control': 'max-age=60' } });
  assert.equal(p.satisfiesWithoutRevalidation(req('max-stale=999999')), false);
});
test('ordinary expired and explicitly public responses still support max-stale', () => {
  const p = policy({ 'cache-control': 'max-age=1' });
  assert.equal(p.satisfiesWithoutRevalidation(req('max-stale=60')), true);
  const pub = policy({ 'cache-control': 'public, max-age=60', 'set-cookie': 'session=synthetic' });
  assert.equal(pub.satisfiesWithoutRevalidation(req()), true);
  const personal = policy({ 'set-cookie': 'session=synthetic', 'cache-control': 'max-age=60' }, { shared: false });
  assert.equal(personal.satisfiesWithoutRevalidation(req()), true);
});

test('nested consumers resolve the patched artifacts', () => {
  for (const consumer of ['micromatch', 'vite-plugin-static-copy']) {
    const nested = createRequire(require.resolve(consumer));
    assert.equal(nested('braces/package.json').name, '@f5-sales-demo/braces-security');
  }
  const astro = createRequire(require.resolve('astro/package.json'));
  assert.equal(astro('http-cache-semantics/package.json').name, '@f5-sales-demo/http-cache-semantics-security');
});
