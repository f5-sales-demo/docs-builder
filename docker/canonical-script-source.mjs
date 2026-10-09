import fs from 'node:fs';
import path from 'node:path';

const [content, output] = process.argv.slice(2);
for (const name of fs.readdirSync(output, { recursive: true }).filter((name) => name.endsWith('.html'))) {
  const file = path.join(output, name);
  const html = fs.readFileSync(file, 'utf8');
  const enriched = html.replace(/<div\b[^>]*\bdata-xcsh-source-file="([^"]+)"[^>]*>/g, (tag, source) => {
    const selected = path.resolve(content, source);
    if (!selected.startsWith(path.resolve(content) + path.sep) || !source.endsWith('.sh'))
      throw Error('Script source must be a shell file in the content root');
    const bytes = fs.readFileSync(selected);
    if (!bytes.toString('utf8').startsWith('#!')) throw Error('Script source requires a shebang');
    return tag.replace(/data-xcsh-source-file="[^"]+"/, `data-xcsh-source="${bytes.toString('base64')}"`);
  });
  if (enriched !== html) fs.writeFileSync(file, enriched);
}
