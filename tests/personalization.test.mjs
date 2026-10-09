import assert from 'node:assert/strict';
import * as requireChildProcess from 'node:child_process';
import test from 'node:test';

test('cleared canonical identifiers retain placeholders in every context', () => {
  for (const context of ['text', 'json', 'hcl', 'shell'])
    assert.equal(substitute('"<XCSH_NAMESPACE>"', { XCSH_NAMESPACE: '' }, context), '"<XCSH_NAMESPACE>"');
});

test('script discovery stays authoritative when identifiers are selected in the form', () => {
  const source = '#!/bin/bash\nXCSH_GRAPH_SOURCE="$(discover)"\nprintf "%s" "$XCSH_VIRTUAL_HOST"\n';
  const values = { XCSH_GRAPH_SOURCE: 'pasted-source', XCSH_VIRTUAL_HOST: 'pasted-host' };
  assert.equal(
    renderRunnable(source, Object.keys(values), values, {
      mode: 'script',
      fields: {
        XCSH_VIRTUAL_HOST: { discovered: true },
      },
    }),
    source,
  );
});

import { createStore, renderRunnable, resolveManifest, shellQuote, substitute } from '../src/lib/personalization.mjs';

const catalog = {
  XCSH_NAMESPACE: { default: 'demo-app', credential: false, scope: 'namespace' },
  XCSH_API_TOKEN: { default: '<XCSH_API_TOKEN>', credential: true, scope: 'api-token' },
  XCSH_DOMAINNAME: { default: 'app.example.com', credential: false, scope: 'application-hostname' },
};
const manifest = { version: 2, fields: Object.keys(catalog) };
class Storage {
  data = new Map();
  get length() {
    return this.data.size;
  }
  key(i) {
    return [...this.data.keys()][i];
  }
  getItem(k) {
    return this.data.get(k) ?? null;
  }
  setItem(k, v) {
    this.data.set(k, v);
  }
  removeItem(k) {
    this.data.delete(k);
  }
}
const setup = (local = new Storage(), session = new Storage(), m = manifest) =>
  createStore(resolveManifest(m, catalog), {
    local,
    session,
    catalog,
    legacy: {
      dns: {
        F5XC_NAMESPACE: { name: 'XCSH_NAMESPACE', default: 'old-default' },
        F5XC_API_TOKEN: { name: 'XCSH_API_TOKEN', default: 'example-api-token' },
      },
    },
  });
test('untouched defaults belong to each guide; explicit edits follow navigation', () => {
  const local = new Storage(),
    session = new Storage(),
    a = setup(local, session);
  assert.equal(a.load().XCSH_NAMESPACE, 'demo-app');
  a.set('XCSH_NAMESPACE', 'reader');
  const b = setup(local, session);
  assert.equal(b.load().XCSH_NAMESPACE, 'reader');
  assert.equal(JSON.parse(local.getItem('f5-docs-values-v1')).version, 1);
});
test('credentials use session only; reset and credential clear are independent', () => {
  const local = new Storage(),
    session = new Storage(),
    a = setup(local, session);
  a.set('XCSH_API_TOKEN', 'SECRET');
  a.set('XCSH_NAMESPACE', 'reader');
  a.reset();
  assert.equal(a.load().XCSH_API_TOKEN, 'SECRET');
  assert.equal(a.load().XCSH_NAMESPACE, 'demo-app');
  assert.ok(![...local.data.values()].join('').includes('SECRET'));
  assert.equal(setup(local, new Storage()).load().XCSH_API_TOKEN, '<XCSH_API_TOKEN>');
  a.clearCredentials();
  assert.equal(a.load().XCSH_API_TOKEN, '<XCSH_API_TOKEN>');
});
test('legacy migration promotes overrides only and removes persisted tokens', () => {
  const local = new Storage();
  local.setItem(
    'f5xc-placeholders-dns',
    JSON.stringify({ F5XC_NAMESPACE: 'old-default', F5XC_API_TOKEN: 'OLD_SECRET' }),
  );
  const a = setup(local);
  assert.equal(a.load().XCSH_NAMESPACE, 'demo-app');
  assert.equal(local.getItem('f5xc-placeholders-dns'), null);
  assert.ok(![...local.data.values()].join('').includes('OLD_SECRET'));
  const b = new Storage();
  b.setItem('f5xc-placeholders-dns', JSON.stringify({ F5XC_NAMESPACE: 'reader' }));
  assert.equal(setup(b).load().XCSH_NAMESPACE, 'reader');
});
test('unavailable and malformed storage retains working in-memory edits', () => {
  const bad = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('denied');
    },
    removeItem() {
      throw Error('denied');
    },
  };
  const a = setup(bad, bad);
  a.set('XCSH_NAMESPACE', 'reader');
  assert.equal(a.load().XCSH_NAMESPACE, 'reader');
});
test('independent updates preserve other repositories and concurrent tab values', () => {
  const local = new Storage(),
    a = setup(local),
    b = setup(local);
  a.set('XCSH_NAMESPACE', 'first');
  b.set('XCSH_DOMAINNAME', 'second.example.com');
  assert.equal(a.load().XCSH_NAMESPACE, 'first');
  assert.equal(a.load().XCSH_DOMAINNAME, 'second.example.com');
});
test('JSON and HCL escaping, legacy markers and ordinary shell expressions', () => {
  const value = 'quote"\\\n${literal}';
  assert.equal(JSON.parse(substitute('{"ns":"<XCSH_NAMESPACE>"}', { XCSH_NAMESPACE: value }, 'json')).ns, value);
  assert.ok(substitute('"xXCSH_NAMESPACEx"', { XCSH_NAMESPACE: value }, 'hcl').includes('$${literal}'));
  assert.equal(
    substitute('$XCSH_NAMESPACE ${XCSH_NAMESPACE} $((END-1)) $(date)', { XCSH_NAMESPACE: 'reader' }, 'text'),
    '$XCSH_NAMESPACE ${XCSH_NAMESPACE} $((END-1)) $(date)',
  );
});
test('complete runnable output quotes exports and leaves discovery commands intact', () => {
  const value = "O'Brien; $(touch /tmp/never) `id`";
  const command = 'XCSH_END_TIME="$(date -u +%s)"\nprintf "%s" "$XCSH_NAMESPACE"';
  const result = renderRunnable(command, ['XCSH_NAMESPACE'], { XCSH_NAMESPACE: value });
  assert.equal(result, 'export XCSH_NAMESPACE=' + shellQuote(value) + '\n\n' + command);
});
test('reject invalid field names and missing catalog fields', () => {
  assert.throws(() => resolveManifest({ version: 2, fields: ['XCHS_NAMESPACE'] }, catalog));
  assert.throws(() => resolveManifest({ version: 2, fields: ['XCSH_MISSING'] }, catalog));
});
test('shell JSON payload escapes both JSON and shell apostrophes', () => {
  const value = 'O\'Brien "quoted" \\ path\n';
  const template = 'curl -d \'{"namespace":"<XCSH_NAMESPACE>"}\' https://example.com';
  const script = substitute(template, { XCSH_NAMESPACE: value }, 'shell').replace('curl', 'capture');
  const { execFileSync } = requireChildProcess;
  const output = execFileSync('/bin/sh', ['-c', 'capture() { printf "%s" "$2"; }; ' + script], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).namespace, value);
});
test('hashed legacy defaults migrate overrides without exposing old values', () => {
  const local = new Storage();
  local.setItem('f5xc-placeholders-dns', JSON.stringify({ F5XC_NAMESPACE: 'old-default' }));
  let hash = 2166136261;
  for (const c of 'old-default') hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const a = createStore(resolveManifest(manifest, catalog), {
    local,
    session: new Storage(),
    catalog,
    legacy: { dns: { F5XC_NAMESPACE: { name: 'XCSH_NAMESPACE', defaultHash: hash.toString(16).padStart(8, '0') } } },
  });
  assert.equal(a.load().XCSH_NAMESPACE, 'demo-app');
});
test('late legacy credentials are scrubbed without repeating migration', () => {
  const local = new Storage();
  const a = setup(local);
  a.load();
  local.setItem('f5xc-placeholders-dns', JSON.stringify({ F5XC_NAMESPACE: 'late', F5XC_API_TOKEN: 'OLD_SECRET' }));
  const b = setup(local);
  assert.equal(b.load().XCSH_NAMESPACE, 'demo-app');
  assert.equal(local.getItem('f5xc-placeholders-dns'), null);
});
test('invalid durable credential values are scrubbed', () => {
  const local = new Storage();
  local.setItem(
    'f5-docs-values-v1',
    JSON.stringify({ version: 1, migrated: true, values: { XCSH_API_TOKEN: 'OLD_SECRET' } }),
  );
  setup(local).load();
  assert.ok(!local.getItem('f5-docs-values-v1').includes('OLD_SECRET'));
});
test('legacy schemas normalize during coordinated consumer publication', () => {
  const aliases = { F5XC_NAMESPACE: 'XCSH_NAMESPACE', TARGET_FQDN: 'XCSH_DOMAINNAME' };
  for (const old of [
    {
      fields: { F5XC_NAMESPACE: { type: 'text', default: 'old-default', description: 'Namespace' } },
      groups: [{ label: 'API', keys: ['F5XC_NAMESPACE'] }],
    },
    { fields: [{ name: 'TARGET_FQDN', label: 'Target', placeholder: 'demo.example.com' }] },
    { F5XC_NAMESPACE: { description: 'Namespace', example: 'old-default' } },
  ]) {
    const result = resolveManifest(old, catalog, aliases);
    assert.ok(Object.keys(result.fields).length);
    assert.ok(Object.keys(result.fields).every((k) => k.startsWith('XCSH_')));
  }
});

test('inline substitutes every command argument without adding exports', () => {
  const source = 'XCSH_JSON="$(capture --arg ns "<XCSH_NAMESPACE>" "https://<XCSH_DOMAINNAME>/${XCSH_ORIGIN_POOL}")"';
  const values = { XCSH_NAMESPACE: 'Reader "quote" \\ $HOME $(id)', XCSH_DOMAINNAME: 'app.example.com' };
  const rendered = renderRunnable(source, Object.keys(values), values, { mode: 'inline' });
  assert.ok(!rendered.startsWith('export '));
  assert.ok(rendered.includes('${XCSH_ORIGIN_POOL}'));
  const result = requireChildProcess.execFileSync(
    '/bin/sh',
    ['-c', 'capture() { printf "%s" "$3"; }; ' + rendered + '\nprintf "%s" "$XCSH_JSON"'],
    { encoding: 'utf8' },
  );
  assert.equal(result, values.XCSH_NAMESPACE);
});
test('script exports follow shebang and never embed credentials', () => {
  const source = '#!/usr/bin/env bash\nset -euo pipefail\n: "${XCSH_API_TOKEN:?}"\nprintf "%s" "$XCSH_NAMESPACE"\n';
  const values = { XCSH_NAMESPACE: "O'Brien \\ $HOME $(id)", XCSH_API_TOKEN: 'SECRET_SENTINEL' };
  const rendered = renderRunnable(source, Object.keys(values), values, { mode: 'script' });
  assert.ok(rendered.startsWith('#!/usr/bin/env bash\nexport XCSH_NAMESPACE='));
  assert.ok(!rendered.includes('SECRET_SENTINEL'));
  assert.ok(!rendered.includes('export XCSH_API_TOKEN='));
  assert.ok(rendered.endsWith(source.slice(source.indexOf('\n') + 1)));
  requireChildProcess.execFileSync('/bin/sh', ['-n'], { input: rendered });
});

test('credential catalog classification also excludes nonstandard secret fields', () => {
  const output = renderRunnable(
    '#!/bin/sh\nprintf ok\n',
    ['XCSH_AUTH_VALUE'],
    { XCSH_AUTH_VALUE: 'SECRET_SENTINEL' },
    { mode: 'script', fields: { XCSH_AUTH_VALUE: { credential: true } } },
  );
  assert.equal(output, '#!/bin/sh\nprintf ok\n');
});

const defaultManifest = { ...manifest, behavior: { fallbackToDefaults: true, environmentToken: true } };
test('opt-in defaults resolve saved blanks, clearing, reload and reset without changing other consumers', () => {
  const local = new Storage(),
    session = new Storage();
  local.setItem('f5-docs-values-v1', JSON.stringify({ version: 1, values: { XCSH_NAMESPACE: '' } }));
  const store = setup(local, session, defaultManifest);
  assert.equal(store.load().XCSH_NAMESPACE, 'demo-app');
  assert.equal(store.load().XCSH_API_TOKEN, '');
  store.set('XCSH_NAMESPACE', 'reader');
  store.set('XCSH_API_TOKEN', 'SESSION_TOKEN');
  assert.equal(setup(local, session, defaultManifest).load().XCSH_NAMESPACE, 'reader');
  store.set('XCSH_NAMESPACE', '');
  assert.equal(store.load().XCSH_NAMESPACE, 'demo-app');
  assert.equal(setup(local, session).load().XCSH_NAMESPACE, '');
  store.reset();
  assert.equal(store.load().XCSH_API_TOKEN, 'SESSION_TOKEN');
  store.clearCredentials();
  assert.equal(store.load().XCSH_API_TOKEN, '');
  assert.ok(![...local.data.values()].join('').includes('SESSION_TOKEN'));
});
test('opt-in fallback resolves prose, structured code and shell from unchanged templates', () => {
  const { fields } = resolveManifest(defaultManifest, catalog);
  const values = { XCSH_NAMESPACE: '', XCSH_API_TOKEN: '' };
  assert.equal(substitute('<XCSH_NAMESPACE>', values, 'text', fields), 'demo-app');
  assert.deepEqual(JSON.parse(substitute('{"ns":"<XCSH_NAMESPACE>"}', values, 'json', fields)), { ns: 'demo-app' });
  assert.equal(substitute('"<XCSH_NAMESPACE>"', values, 'hcl', fields), '"demo-app"');
  assert.equal(substitute('<XCSH_API_TOKEN>', values, 'text', fields), '$XCSH_API_TOKEN');
  assert.equal(
    renderRunnable('printf %s "<XCSH_NAMESPACE>"', ['XCSH_NAMESPACE'], values, { mode: 'inline', fields }),
    'printf %s "demo-app"',
  );
});
test('unset environment token expands safely in every shell quote context; entered token stays literal', () => {
  const { fields } = resolveManifest(defaultManifest, catalog);
  const token = 'mock O\'Brien "quote" \\ $HOME $(id) `id`\nnext';
  for (const template of [
    'capture <XCSH_API_TOKEN>',
    'capture "<XCSH_API_TOKEN>"',
    "capture 'prefix <XCSH_API_TOKEN> suffix'",
  ]) {
    for (const entered of ['', token]) {
      const rendered = renderRunnable(
        template,
        ['XCSH_API_TOKEN'],
        { XCSH_API_TOKEN: entered },
        { mode: 'inline', fields },
      );
      const output = requireChildProcess.execFileSync(
        '/bin/sh',
        ['-c', 'capture() { test "$#" = 1; printf "%s" "$1"; }; ' + rendered],
        {
          encoding: 'utf8',
          env: { ...process.env, XCSH_API_TOKEN: entered ? 'different-token' : token },
        },
      );
      assert.equal(output, template.includes('prefix') ? 'prefix ' + token + ' suffix' : token);
    }
  }
});
test('setup preserves an existing environment token and reports a missing one', () => {
  const { fields } = resolveManifest(defaultManifest, catalog);
  const source =
    'export XCSH_API_TOKEN="<XCSH_API_TOKEN>"\n: "${XCSH_API_TOKEN:?Set XCSH_API_TOKEN}"\nprintf %s "$XCSH_API_TOKEN"';
  const output = renderRunnable(source, ['XCSH_API_TOKEN'], { XCSH_API_TOKEN: '' }, { mode: 'inline', fields });
  const env = { ...process.env, XCSH_API_TOKEN: 'mock token $HOME' };
  assert.equal(
    requireChildProcess.execFileSync('/bin/sh', ['-c', output], { encoding: 'utf8', env }),
    env.XCSH_API_TOKEN,
  );
  delete env.XCSH_API_TOKEN;
  const result = requireChildProcess.spawnSync('/bin/sh', ['-c', output], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set XCSH_API_TOKEN/);
  const script = '#!/bin/sh\n: "${XCSH_API_TOKEN:?}"\n';
  assert.equal(
    renderRunnable(script, ['XCSH_API_TOKEN'], { XCSH_API_TOKEN: 'SESSION_TOKEN' }, { mode: 'script', fields }),
    script,
  );
});
test('optional behavior rejects invalid configuration and never allows credential example defaults', () => {
  for (const behavior of [{ fallbackToDefaults: 'yes' }, { environmentToken: 1 }, { unknown: true }, []])
    assert.throws(() => resolveManifest({ ...manifest, behavior }, catalog));
  assert.equal(
    resolveManifest({ ...defaultManifest, examples: { XCSH_API_TOKEN: 'BAD' } }, catalog).fields.XCSH_API_TOKEN.default,
    '',
  );
});
