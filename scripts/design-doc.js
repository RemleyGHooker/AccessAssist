// Writes docs/design-requirements.md from src/design.js (npm run design:doc).
import { writeFileSync } from 'node:fs';
import { designDoc } from '../src/design.js';

writeFileSync(new URL('../docs/design-requirements.md', import.meta.url), designDoc());
console.log('docs/design-requirements.md updated');
