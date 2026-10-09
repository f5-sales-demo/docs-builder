import { useCallback, useEffect, useState } from 'react';
import {
  clearCredentials,
  clearValues,
  emitChange,
  FIELD_GROUPS,
  loadValues,
  placeholderDefs,
  setValue,
  subscribe,
} from '../lib/placeholder-store';

export default function PlaceholderForm() {
  const [values, setValues] = useState<Record<string, string>>(() => loadValues());
  const refresh = useCallback(() => {
    const next = loadValues();
    setValues(next);
    emitChange(next);
  }, []);
  useEffect(() => {
    refresh();
    return subscribe(refresh);
  }, [refresh]);
  if (Object.keys(placeholderDefs).length === 0) return null;
  return (
    <details className="ph-form-wrapper">
      <summary>Customize examples</summary>
      {Object.values(placeholderDefs).some((def) => def.fallbackToDefault) && (
        <p>
          Examples start with illustrative defaults. Replace them with values from your environment and the linked
          discovery procedures. Each field is independent. Clearing a field restores its default in examples; leaving
          the field restores its displayed value.
        </p>
      )}
      {placeholderDefs.XCSH_API_TOKEN?.environmentToken && (
        <p>
          Leave the API token empty to use $XCSH_API_TOKEN from your shell environment. Enter a token to include it in
          copied inline commands; Clear credentials restores the environment reference.
        </p>
      )}
      <p id="ph-storage-help">
        Edited values follow matching fields across F5 guides in this browser. Credentials stay in this tab’s session
        and are masked in the form. Copying an example includes its required credentials. Browser session restore may
        retain them; use Clear credentials to remove them. Values stay in your browser and are never submitted. If
        storage is unavailable, edits last until navigation.
      </p>
      <form id="placeholder-form" aria-describedby="ph-storage-help" onSubmit={(e) => e.preventDefault()}>
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.label}>
            <legend>{group.label}</legend>
            {group.description && <p>{group.description}</p>}
            <div className="ph-grid">
              {group.keys.map((key: string) => {
                const def = placeholderDefs[key];
                return (
                  <label key={key} htmlFor={'ph-' + key}>
                    <span className="ph-label">{def.description}</span>
                    {def.type === 'dropdown' && def.options ? (
                      <select
                        id={'ph-' + key}
                        value={values[key] ?? def.default}
                        onChange={(e) => {
                          setValue(key, e.target.value);
                          const next = loadValues();
                          setValues({ ...next, [key]: e.target.value });
                          emitChange(next);
                        }}
                        onBlur={refresh}
                      >
                        {def.options.map((opt: string) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={'ph-' + key}
                        type={def.credential ? 'password' : def.type === 'number' ? 'number' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={'<' + key + '>'}
                        aria-describedby={def.hint ? 'ph-hint-' + key : undefined}
                        value={values[key] ?? def.default}
                        onChange={(e) => {
                          setValue(key, e.target.value);
                          const next = loadValues();
                          setValues({ ...next, [key]: e.target.value });
                          emitChange(next);
                        }}
                        onBlur={refresh}
                      />
                    )}
                    {def.hint && <span id={'ph-hint-' + key}>{def.hint}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="ph-reset"
          onClick={() => {
            clearValues();
            refresh();
          }}
        >
          Reset shared values
        </button>
        <button
          type="button"
          className="ph-reset"
          onClick={() => {
            clearCredentials();
            refresh();
          }}
        >
          Clear credentials
        </button>
      </form>
    </details>
  );
}
