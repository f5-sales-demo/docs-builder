import catalog from '../data/field-catalog.json';
import legacy from '../data/legacy-fields.json';
import manifest from '../data/placeholders.json';
import { createStore, resolveManifest } from './personalization.mjs';

const aliases = Object.assign(
  {},
  ...Object.values(legacy).map((fields) =>
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.name])),
  ),
);
const definition = resolveManifest(manifest, catalog, aliases);
export const placeholderDefs = definition.fields;
export const FIELD_GROUPS = definition.groups;
function storage(kind: 'localStorage' | 'sessionStorage') {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
}
const store = createStore(definition, {
  local: storage('localStorage'),
  session: storage('sessionStorage'),
  catalog,
  legacy,
});
export const loadValues = store.load;
export const setValue = store.set;
export const clearValues = store.reset;
export const clearCredentials = store.clearCredentials;
export function getDefaults(): Record<string, string> {
  return Object.fromEntries(Object.entries(placeholderDefs).map(([key, def]) => [key, def.default]));
}
export function getAllValues(values: Record<string, string>): Record<string, string> {
  const cidr = values.XCSH_PROTECTED_CIDR_V4;
  const legacyValues = Object.fromEntries(
    Object.entries(definition.aliases).map(([old, name]) => [old, values[name as string]]),
  );
  values = { ...values, ...legacyValues };
  if (!cidr) return values;
  const bits = Math.max(0, Math.min(32, Number(cidr.match(/^\/(\d+)/)?.[1] ?? 24)));
  const mask = [24, 16, 8, 0].map((shift) => ((bits === 0 ? 0 : 0xffffffff << (32 - bits)) >>> shift) & 255).join('.');
  return {
    ...values,
    XCSH_PROTECTED_MASK_V4: mask,
    PROTECTED_MASK_V4: mask,
    XCSH_PROTECTED_PREFIX_V4: values.XCSH_PROTECTED_NET_V4 + '/' + bits,
    PROTECTED_PREFIX_V4: values.XCSH_PROTECTED_NET_V4 + '/' + bits,
  };
}
export function emitChange(values = loadValues()) {
  document.dispatchEvent(new CustomEvent('placeholder-change', { detail: getAllValues(values) }));
}
export function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'f5-docs-values-v1' || event.key === 'f5-docs-credentials-v1' || event.key === null) callback();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
