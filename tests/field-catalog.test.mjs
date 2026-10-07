import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveManifest } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url)));
test('catalog names, descriptions, credential classification and semantic scopes', () => {
  for (const [name, field] of Object.entries(catalog)) {
    assert.match(name, /^XCSH_[A-Z][A-Z0-9_]*$/);
    assert.equal(typeof field.default, 'string');
    assert.equal(typeof field.credential, 'boolean');
    assert.ok(field.scope && field.description);
    if (/TOKEN|PASSWORD|SECRET|PRIVATE_KEY/.test(name)) assert.ok(field.credential);
  }
  assert.notEqual(catalog.XCSH_DNS_ZONE.scope, catalog.XCSH_DOMAINNAME.scope);
  assert.notEqual(catalog.XCSH_ORIGIN_IP.scope, catalog.XCSH_TGEN_IP.scope);
});
test('all governed form consumer manifests select catalog fields', () => {
  const root = process.env.FORM_CONSUMER_ROOT;
  if (!root) return;
  for (const repo of [
    'statistics',
    'csd',
    'dns',
    'ddos',
    'webapp-api-protection',
    'traffic-generator',
    'demo-resource-template',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(root + '/' + repo + '/docs/placeholders.json'));
    resolveManifest(manifest, catalog);
  }
});
