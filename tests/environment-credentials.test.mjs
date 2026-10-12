import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { createStore, renderRunnable, resolveManifest, substitute } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url)));
const names = ['XCSH_API_TOKEN', 'XCSH_TLS_INPUT_PASSWORD', 'XCSH_KEY_FILE', 'XCSH_CERT_FILE'];
const manifest = { version: 2, fields: names, behavior: { fallbackToDefaults: true, environmentCredentials: true } };
class Storage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(i) {
    return [...this.values.keys()][i];
  }
  getItem(k) {
    return this.values.get(k) ?? null;
  }
  setItem(k, v) {
    this.values.set(k, v);
  }
  removeItem(k) {
    this.values.delete(k);
  }
}
test('certificate paths are durable noncredentials with visible defaults and hints', () => {
  const { fields } = resolveManifest(manifest, catalog);
  for (const name of ['XCSH_KEY_FILE', 'XCSH_CERT_FILE']) {
    assert.equal(fields[name].credential, false);
    assert.equal(fields[name].default, '<' + name + '>');
    assert.ok(fields[name].hint);
  }
});
test('passphrase and token use session storage; reset and clear remain independent', () => {
  const definition = resolveManifest(manifest, catalog);
  const local = new Storage(),
    session = new Storage();
  const store = createStore(definition, { local, session, catalog });
  store.set('XCSH_KEY_FILE', '/private/reader key.pem');
  for (const name of names.slice(0, 2)) store.set(name, 'SESSION_SENTINEL');
  assert.ok(!JSON.stringify([...local.values]).includes('SESSION_SENTINEL'));
  assert.equal(createStore(definition, { local, session, catalog }).load().XCSH_TLS_INPUT_PASSWORD, 'SESSION_SENTINEL');
  assert.equal(createStore(definition, { local, session: new Storage(), catalog }).load().XCSH_TLS_INPUT_PASSWORD, '');
  store.reset();
  assert.equal(store.load().XCSH_KEY_FILE, '<XCSH_KEY_FILE>');
  assert.equal(store.load().XCSH_TLS_INPUT_PASSWORD, 'SESSION_SENTINEL');
  store.clearCredentials();
  assert.equal(store.load().XCSH_TLS_INPUT_PASSWORD, '');
  assert.equal(store.load().XCSH_API_TOKEN, '');
});
test('blank credentials preserve environment values, entered credentials stay literal in every shell quote', () => {
  const { fields } = resolveManifest(manifest, catalog);
  const value = 'O\'Brien "quote" \\ space $HOME $(id) `id` ${literal} %{literal}\nnext';
  for (const name of names.slice(0, 2)) {
    for (const entered of ['', value]) {
      for (const template of ['capture <' + name + '>', 'capture "<' + name + '>"', "capture '<" + name + ">'"]) {
        const rendered = renderRunnable(template, [name], { [name]: entered }, { mode: 'inline', fields });
        assert.equal(
          execFileSync('/bin/sh', ['-c', 'capture() { test "$#" = 1; printf %s "$1"; }; ' + rendered], {
            encoding: 'utf8',
            env: { ...process.env, [name]: value },
          }),
          value,
        );
      }
      const rendered = renderRunnable('printf %s "$' + name + '"', [name], { [name]: entered }, { fields });
      assert.equal(
        execFileSync('/bin/sh', ['-c', rendered], { encoding: 'utf8', env: { ...process.env, [name]: value } }),
        value,
      );
    }
    assert.equal(substitute('<' + name + '>', { [name]: '' }, 'text', fields), '$' + name);
    for (const context of ['json', 'hcl'])
      assert.equal(substitute('"<' + name + '>"', { [name]: value }, context, fields), '"<' + name + '>"');
  }
});
test('literal paths escape in shell, JSON and HCL and credentials never enter script downloads', () => {
  const { fields } = resolveManifest(manifest, catalog);
  const value = 'O\'Brien "quote" \\ space $HOME $(id) `id` ${literal} %{literal}\nnext';
  assert.equal(JSON.parse(substitute('"<XCSH_KEY_FILE>"', { XCSH_KEY_FILE: value }, 'json', fields)), value);
  assert.ok(
    substitute('"<XCSH_KEY_FILE>"', { XCSH_KEY_FILE: value }, 'hcl', fields).includes('$${literal} %%{literal}'),
  );
  const rendered = renderRunnable(
    '#!/bin/sh\nprintf %s "$XCSH_KEY_FILE"\n',
    names,
    Object.fromEntries(names.map((n) => [n, value])),
    { mode: 'script', fields },
  );
  assert.ok(!rendered.includes('export XCSH_TLS_INPUT_PASSWORD='));
  assert.ok(!rendered.includes('export XCSH_API_TOKEN='));
});
test('disabled storage retains and clears session credentials in memory', () => {
  const definition = resolveManifest(manifest, catalog);
  const store = createStore(definition);
  store.set('XCSH_TLS_INPUT_PASSWORD', 'SESSION_SENTINEL');
  store.set('XCSH_KEY_FILE', 'reader.pem');
  store.reset();
  assert.equal(store.load().XCSH_TLS_INPUT_PASSWORD, 'SESSION_SENTINEL');
  store.clearCredentials();
  assert.equal(store.load().XCSH_TLS_INPUT_PASSWORD, '');
});
