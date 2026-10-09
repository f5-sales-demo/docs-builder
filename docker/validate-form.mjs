import fs from 'node:fs';
import path from 'node:path';
import { resolveManifest } from '../src/lib/personalization.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/field-catalog.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(new URL('../src/data/legacy-fields.json', import.meta.url), 'utf8'));
const aliases = Object.assign(
  {},
  ...Object.values(legacy).map((fields) =>
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.name])),
  ),
);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const definition = resolveManifest(manifest, catalog, aliases);
const root = process.argv[3];
const repo = (process.argv[4] ?? '').split('/').at(-1);
if (root && repo === 'statistics')
  validateStatistics(root, definition.fields, manifest.statisticsAuthoringVersion === 2);

function validateStatistics(root, fields, strict) {
  const failures = [];
  const attribute = (tag, name) => tag.match(new RegExp(name + '="([^"]*)"'))?.[1];
  const pages = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? pages(file)
        : /\.mdx?$/.test(file)
          ? [path.relative(path.join(root, 'en'), file)]
          : [];
    });
  for (const file of pages(path.join(root, 'en')).sort()) {
    const lines = fs.readFileSync(path.join(root, 'en', file), 'utf8').split('\n');
    const stack = [];
    let block = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*<div\b/.test(line)) stack.push(line);
      if (/^\s*<\/div>/.test(line)) stack.pop();
      const tag = [...stack].reverse().find((s) => /data-xcsh-(?:fields|context|render)/.test(s)) ?? '';
      const required = (attribute(tag, 'data-xcsh-fields') ?? '').split(/[\s,]+/).filter(Boolean);
      const excluded = stack.some((s) => attribute(s, 'data-personalize') === 'off');
      const checkMarkers = (code, location, structured = false) => {
        if (!strict) return;
        for (const name of required)
          if (!Object.hasOwn(fields, name)) failures.push(location + ': Unselected configuration field: ' + name);
        for (const match of code.matchAll(/<(XCSH_[A-Z][A-Z0-9_]*)>/g)) {
          const name = match[1];
          if (!Object.hasOwn(fields, name)) failures.push(location + ': Unknown or unselected placeholder: ' + name);
          if (excluded) failures.push(location + ': Identity placeholder inside personalization exclusion: ' + name);
          if (structured && !required.includes(name)) failures.push(location + ': Undeclared form dependency: ' + name);
        }
      };
      const fence = line.match(/^\s*(`{3,}|~{3,})([\w-]*)(.*)$/);
      if (!fence) {
        checkMarkers(line, `${file}:${i + 1}`);
        continue;
      }
      const start = i + 1;
      block++;
      const source = [];
      while (++i < lines.length && !new RegExp('^\\s*' + fence[1] + '\\s*$').test(lines[i])) source.push(lines[i]);
      const location = `${file}:${start} block ${block}`;
      const fail = (message) => failures.push(location + ': ' + message);
      const mode = attribute(tag, 'data-xcsh-render');
      let code = source.join('\n');
      checkMarkers(code, location, true);
      if (!['bash', 'sh', 'shell'].includes(fence[2]) || excluded) continue;
      const imported = fence[3].match(/\bfile=([^\s]+)/)?.[1];
      if (imported) {
        const script = path.resolve(root, 'en', path.dirname(file), imported);
        if (!script.startsWith(path.resolve(root) + path.sep)) {
          fail('Script source must belong to content root');
          continue;
        }
        code = fs.readFileSync(script, 'utf8');
        if (mode !== 'script' || !code.startsWith('#!')) fail('Imported script requires script rendering and shebang');
        for (const name of Object.keys(fields))
          if (new RegExp('\\b' + name + '\\b').test(code) && !required.includes(name))
            fail('Missing script configuration: ' + name);
        // Script sources remain runtime programs; dynamic placeholders would freeze discovery.
        if (/<XCSH_[A-Z0-9_]+>/.test(code)) fail('Script source must retain runtime expressions');
      } else {
        const assigned = new Set([...code.matchAll(/^\s*(?:export\s+)?(XCSH_[A-Z0-9_]+)=/gm)].map((m) => m[1]));
        for (const name of Object.keys(fields)) {
          if (!assigned.has(name) && new RegExp('\\$\\{' + name + '(?:\\}|[^A-Z0-9_])|\\$' + name + '\\b').test(code))
            fail('Configured input must use explicit placeholder: ' + name);
          if (code.includes('<' + name + '>') && (!required.includes(name) || mode !== 'inline'))
            fail('Placeholder requires inline rendering and declared field: ' + name);
        }
        for (const match of code.matchAll(/<(XCSH_[A-Z][A-Z0-9_]*)>/g))
          if (!Object.hasOwn(fields, match[1])) fail('Dynamic identifier must remain an expression: ' + match[1]);
      }
    }
  }
  if (failures.length) throw Error('Statistics authoring failed:\n' + failures.join('\n'));
}
