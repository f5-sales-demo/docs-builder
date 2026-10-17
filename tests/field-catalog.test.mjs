import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveManifest } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url)));
const legacy = JSON.parse(fs.readFileSync(new URL('../src/data/legacy-fields.json', import.meta.url)));
const aliases = Object.assign(
  {},
  ...Object.values(legacy).map((fields) =>
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.name])),
  ),
);
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
    'certificate-management',
    'statistics',
    'csd',
    'dns',
    'ddos',
    'webapp-api-protection',
    'traffic-generator',
    'demo-resource-template',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(root + '/' + repo + '/docs/placeholders.json'));
    resolveManifest(manifest, catalog, aliases);
  }
});
import { createStore, substitute } from '../src/lib/personalization.mjs';

test('Wingman fields retain independent identities, placeholders and literal shell values', () => {
  const names = [
    'XCSH_WINGMAN_NAME',
    'XCSH_WINGMAN_SITE_SELECTOR',
    'XCSH_KUBECONFIG_FILE',
    'XCSH_KUBECONFIG_CONTEXT',
    'XCSH_WINGMAN_IMAGE',
    'XCSH_APPLICATION_CERT_FILE',
  ];
  const definition = resolveManifest({ version: 2, fields: names, behavior: { fallbackToDefaults: true } }, catalog);
  const backing = new Map();
  const storage = {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key),
  };
  const store = createStore(definition, { local: storage, session: storage });
  for (const name of names) {
    assert.equal(
      definition.fields[name].default,
      name === 'XCSH_WINGMAN_IMAGE' ? 'ghcr.io/f5-sales-demo/certificate-management-wingman:latest' : '<' + name + '>',
    );
    assert.equal(definition.fields[name].credential, false);
    assert.ok(definition.fields[name].hint);
  }
  store.set('XCSH_WINGMAN_NAME', 'reader-wingman');
  store.set('XCSH_KUBECONFIG_CONTEXT', 'reader-context');
  store.set('XCSH_KUBECONFIG_FILE', "/private/reader's kubeconfig");
  const values = store.load();
  assert.equal(values.XCSH_WINGMAN_NAME, 'reader-wingman');
  assert.equal(values.XCSH_KUBECONFIG_CONTEXT, 'reader-context');
  assert.equal(values.XCSH_WINGMAN_SITE_SELECTOR, '<XCSH_WINGMAN_SITE_SELECTOR>');
  assert.equal(catalog.XCSH_CONTAINER_IMAGE.default, 'nginx:alpine');
  const command = substitute(
    'kubectl --kubeconfig "<XCSH_KUBECONFIG_FILE>" --context "<XCSH_KUBECONFIG_CONTEXT>"',
    values,
    'shell',
    definition.fields,
  );
  assert.match(command, /reader-context/);
  assert.match(command, /reader/);
});

test('client mTLS fields keep frontend, origin and server material distinct', () => {
  const names = [
    'XCSH_CLIENT_CERT_FILE',
    'XCSH_CLIENT_KEY_FILE',
    'XCSH_CLIENT_CA_FILE',
    'XCSH_CLIENT_CRL_FILE',
    'XCSH_CLIENT_CRL_REVISION',
    'XCSH_CLIENT_CA_DIR',
    'XCSH_CLIENT_NAME',
  ];
  const definition = resolveManifest({ version: 2, fields: names }, catalog);
  const scopes = names.map((name) => definition.fields[name].scope);
  assert.equal(new Set(scopes).size, names.length);
  for (const name of names) {
    assert.equal(catalog[name].credential, false);
    assert.equal(catalog[name].default, '<' + name + '>');
    assert.notEqual(catalog[name].scope, catalog.XCSH_CERT_FILE.scope);
    assert.notEqual(catalog[name].scope, catalog.XCSH_ORIGIN_CA_FILE.scope);
  }
  for (const name of names.filter((name) => /FILE|DIR/.test(name))) {
    assert.match(catalog[name].hint, /outside Git/);
  }
});
