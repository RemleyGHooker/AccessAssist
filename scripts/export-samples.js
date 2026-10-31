import { mkdir, writeFile } from 'node:fs/promises';
import { fixtures } from '../src/fixtures.js';

await mkdir(new URL('../public/samples/', import.meta.url), { recursive: true });
for (const name of ['validPdf', 'missingAltPdf', 'validDocx', 'missingAltDocx']) {
  const fixture = fixtures[name];
  const extension = fixture.name.split('.').at(-1);
  await writeFile(new URL(`../public/samples/${name}.${extension}`, import.meta.url), fixture.data);
}
