export const VALUES_KEY = 'f5-docs-values-v1';
export const CREDENTIALS_KEY = 'f5-docs-credentials-v1';
const safeName = /^XCSH_[A-Z][A-Z0-9_]*$/;
const credentialName = /(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)/;
const own = (o, k) => Object.hasOwn(o, k);
export function resolveManifest(manifest, catalog, aliases = {}) {
  if (manifest.version === undefined) {
    const oldFields = manifest.fields ?? manifest;
    const selected = Array.isArray(oldFields)
      ? oldFields.map((field) => field.name)
      : Object.keys(oldFields).filter((name) => name !== 'groups');
    const canonical = (name) => aliases[name] ?? name;
    const legacyAliases = Object.fromEntries(selected.map((name) => [name, canonical(name)]));
    const normalized = {
      version: 2,
      fields: selected.map(canonical),
      groups: manifest.groups?.map((group) => ({ ...group, keys: group.keys.map(canonical) })),
    };
    const resolved = resolveManifest(normalized, catalog);
    return { ...resolved, aliases: legacyAliases };
  }
  if (manifest.version !== 2 || !Array.isArray(manifest.fields)) throw Error('Expected version 2 field selection');
  const behavior = manifest.behavior ?? {};
  if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) throw Error('Invalid manifest behavior');
  for (const [key, value] of Object.entries(behavior))
    if (!['fallbackToDefaults', 'environmentToken'].includes(key) || typeof value !== 'boolean')
      throw Error('Unknown or invalid manifest behavior: ' + key);
  const fields = {};
  for (const name of manifest.fields) {
    if (!safeName.test(name) || !own(catalog, name)) throw Error('Unknown canonical field: ' + name);
    fields[name] = { ...catalog[name], default: String(manifest.examples?.[name] ?? catalog[name].default) };
    if (fields[name].credential) fields[name].default = '<' + name + '>';
    fields[name].fallbackToDefault = Boolean(behavior.fallbackToDefaults && !fields[name].credential);
    fields[name].environmentToken = Boolean(behavior.environmentToken && name === 'XCSH_API_TOKEN');
    if (fields[name].environmentToken) fields[name].default = '';
    if (fields[name].fallbackToDefault && fields[name].hint)
      fields[name].hint = fields[name].hint.replace(
        'Leave blank to retain its placeholder.',
        'Clear to restore the illustrative default.',
      );
  }
  const groups = manifest.groups ?? [{ label: 'Settings', keys: Object.keys(fields) }];
  for (const group of groups)
    for (const name of group.keys) if (!own(fields, name)) throw Error('Unselected group field: ' + name);
  return { fields, groups, aliases: {} };
}
export function resolveValues(values, fields = {}) {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value === '' && fields[name]?.fallbackToDefault ? fields[name].default : value,
    ]),
  );
}
function defaultHash(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
function read(storage, key) {
  try {
    const record = JSON.parse(storage?.getItem(key) ?? 'null');
    return record?.version === 1 && record.values && typeof record.values === 'object' && !Array.isArray(record.values)
      ? record
      : { version: 1, values: {} };
  } catch {
    return { version: 1, values: {} };
  }
}
export function createStore(definition, { local, session, catalog = definition.fields, legacy = {} } = {}) {
  const memory = { values: {}, credentials: {} };
  let migrated = false;
  function write(storage, key, record) {
    try {
      storage?.setItem(key, JSON.stringify(record));
    } catch {
      /* Memory remains available. */
    }
  }
  function migrate() {
    if (migrated) return;
    migrated = true;
    const record = read(local, VALUES_KEY);
    const alreadyMigrated = Boolean(record.migrated);
    try {
      const keys = Array.from({ length: local.length }, (_, i) => local.key(i)).filter((k) =>
        /^f5xc-placeholders(?:-|$)/.test(k),
      );
      for (const key of keys) {
        let old;
        try {
          old = JSON.parse(local.getItem(key));
        } catch {
          old = null;
        }
        const repo = key.replace(/^f5xc-placeholders-?/, '');
        const known = legacy[repo] ?? {};
        for (const [name, value] of Object.entries(old ?? {})) {
          const mapping = known[name];
          if (!mapping || typeof value !== 'string') continue;
          const target = catalog[mapping.name];
          if (!target || target.credential || credentialName.test(mapping.name)) continue;
          if (
            !alreadyMigrated &&
            (mapping.defaultHash ? defaultHash(value) !== mapping.defaultHash : value !== String(mapping.default)) &&
            !own(record.values, mapping.name)
          )
            record.values[mapping.name] = value;
        }
        local.removeItem(key);
      }
      record.migrated = true;
      write(local, VALUES_KEY, record);
    } catch {
      /* Storage can be disabled. */
    }
  }
  function clean(record, credentials) {
    record.values = Object.fromEntries(
      Object.entries(record.values).filter(
        ([k, v]) =>
          own(catalog, k) &&
          Boolean(catalog[k].credential) === credentials &&
          typeof v === 'string' &&
          !v.includes('\0'),
      ),
    );
    return record;
  }
  function load() {
    migrate();
    const original = read(local, VALUES_KEY);
    const durable = clean({ ...original, values: { ...original.values } }, false);
    if (JSON.stringify(original.values) !== JSON.stringify(durable.values)) write(local, VALUES_KEY, durable);
    const transient = clean(read(session, CREDENTIALS_KEY), true);
    const values = { ...durable.values, ...memory.values, ...transient.values, ...memory.credentials };
    return resolveValues(
      Object.fromEntries(
        Object.entries(definition.fields).map(([k, d]) => [k, own(values, k) ? values[k] : d.default]),
      ),
      definition.fields,
    );
  }
  function set(name, value) {
    const field = definition.fields[name];
    if (!field || typeof value !== 'string' || value.includes('\0')) throw Error('Invalid field value');
    migrate();
    const credentials = Boolean(field.credential);
    const storage = credentials ? session : local,
      key = credentials ? CREDENTIALS_KEY : VALUES_KEY;
    const record = clean(read(storage, key), credentials);
    record.values[name] = value;
    memory[credentials ? 'credentials' : 'values'][name] = value;
    try {
      storage.setItem(key, JSON.stringify(record));
      delete memory[credentials ? 'credentials' : 'values'][name];
    } catch {
      /* Retain edit in memory. */
    }
  }
  function reset() {
    migrate();
    memory.values = {};
    const record = read(local, VALUES_KEY);
    record.values = {};
    write(local, VALUES_KEY, record);
  }
  function clearCredentials() {
    memory.credentials = {};
    try {
      session?.removeItem(CREDENTIALS_KEY);
    } catch {
      /* No durable credentials. */
    }
  }
  return { load, set, reset, clearCredentials };
}
export const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
const marker = /<(XCSH_[A-Z][A-Z0-9_]*)>|x([A-Z][A-Z0-9_]+)x/g;
function stringEscape(value, context) {
  let escaped = JSON.stringify(String(value)).slice(1, -1);
  if (context === 'hcl') escaped = escaped.replaceAll('${', () => '$${').replaceAll('%{', () => '%%{');
  return escaped;
}
export function substitute(template, values, context = 'text', fields = {}) {
  values = resolveValues(values, fields);
  let quote = null,
    escaped = false,
    position = 0;
  const substitutions = [];
  return template.replace(marker, (match, canonical, legacy, offset) => {
    const name = canonical ?? legacy;
    if (!own(values, name)) return match;
    for (; position < offset; position++) {
      const c = template[position];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\' && quote !== "'") {
        escaped = true;
        continue;
      }
      if (context === 'shell' && quote !== "'" && c === '$' && template[position + 1] === '(') {
        substitutions.push({ quote, depth: 1 });
        quote = null;
        position++;
        continue;
      }
      if (context === 'shell' && !quote && substitutions.length) {
        const frame = substitutions.at(-1);
        if (c === '(') frame.depth++;
        if (c === ')' && --frame.depth === 0) quote = substitutions.pop().quote;
      }
      if (c === '"' || (context === 'shell' && c === "'")) {
        if (!quote) quote = c;
        else if (quote === c) quote = null;
      }
    }
    position = offset + match.length;
    const value = String(values[name]);
    if (value === '' && fields[name]?.environmentToken) {
      if (context === 'shell') {
        if (quote === '"') return '$' + name;
        if (quote === "'") return '\'"$' + name + '"\'';
        return '"$' + name + '"';
      }
      if (context === 'text') return '$' + name;
    }
    if (canonical && value === '') return match;
    if (context === 'shell') {
      if (quote === "'") {
        // A single-quoted shell argument may itself contain a JSON document.
        // Escape the structured string before escaping the surrounding shell.
        const argumentStart = template.lastIndexOf("'", offset - 1) + 1;
        const argument = template.slice(argumentStart, offset);
        const jsonString = /^\s*[[{]/.test(argument) && /"(?:[^"\\]|\\.)*$/.test(argument);
        return (jsonString ? stringEscape(value, 'json') : value).replaceAll("'", "'\\''");
      }
      if (quote === '"') return value.replace(/[\\$`"]/g, '\\$&');
      return shellQuote(value);
    }
    if (context === 'json' || context === 'hcl')
      return quote === '"' ? stringEscape(value, context) : '"' + stringEscape(value, context) + '"';
    if (context === 'mermaid')
      return [...value].map((c) => (/[a-zA-Z0-9 .:_/-]/.test(c) ? c : '#' + c.codePointAt(0) + ';')).join('');
    return value;
  });
}
export function renderRunnable(template, required, values, { mode = 'legacy', fields = {} } = {}) {
  values = resolveValues(values, fields);
  const names = [...new Set(required)];
  for (const name of names)
    if (!safeName.test(name) || !own(values, name)) throw Error('Missing required configuration: ' + name);
  if (mode === 'inline') return substitute(template, values, 'shell', fields);
  if (mode === 'script') {
    if (!template.startsWith('#!')) throw Error('Script rendering requires a shebang');
    // Scripts keep runtime expressions, including credentials, authoritative.
    const settings = names.filter(
      (name) =>
        !fields[name]?.credential &&
        !fields[name]?.discovered &&
        !credentialName.test(name) &&
        !new RegExp('^\\s*(?:export\\s+)?' + name + '=', 'm').test(template),
    );
    const exports = settings.map((name) => 'export ' + name + '=' + shellQuote(values[name])).join('\n');
    const end = template.indexOf('\n');
    if (end < 0) throw Error('Script shebang must end with a newline');
    return template.slice(0, end + 1) + (exports ? exports + '\n\n' : '') + template.slice(end + 1);
  }
  if (mode !== 'legacy') throw Error('Unknown shell rendering mode: ' + mode);
  const exports = names
    .map(
      (name) =>
        'export ' +
        name +
        '=' +
        (values[name] === '' && fields[name]?.environmentToken ? '"$' + name + '"' : shellQuote(values[name])),
    )
    .join('\n');
  const nativeOrigin =
    names.includes('XCSH_ORIGIN_POOL_NAME') && /\bXCSH_ORIGIN_POOL\b/.test(template)
      ? '\nexport XCSH_ORIGIN_POOL="$XCSH_ORIGIN_POOL_NAME"'
      : '';
  return (exports ? exports + nativeOrigin + '\n\n' : '') + substitute(template, values, 'shell', fields);
}
