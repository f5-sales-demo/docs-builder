import { readFile, writeFile } from 'node:fs/promises';

const obsoleteImport = "import yaml from 'js-yaml';";
const compatibleImport = "import * as yaml from 'js-yaml';";
const starlightFiles = [
  '../node_modules/@astrojs/starlight/schemas/head.ts',
  '../node_modules/@astrojs/starlight/utils/translations-fs.ts',
];

for (const file of starlightFiles) {
  const path = new URL(file, import.meta.url);
  const source = await readFile(path, 'utf8');

  if (source.includes(compatibleImport)) {
    continue;
  }
  if (!source.includes(obsoleteImport)) {
    throw new Error(`Unable to find the expected Starlight js-yaml import in ${file}; review the image compatibility patch.`);
  }
  await writeFile(path, source.replace(obsoleteImport, compatibleImport));
}

process.stdout.write('Patched Starlight for js-yaml v5 ESM interop.\n');
