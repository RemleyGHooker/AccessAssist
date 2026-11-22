// Keeps the Team 19 design requirements (src/design.js), the suite (src/cases.js) and the published
// mapping (docs/design-requirements.md) in step, so coverage.model cannot drift from the design.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cases } from '../src/cases.js';
import { DESIGN_REQUIREMENTS, designDoc, modelCoverage } from '../src/design.js';

test('every design requirement has a unique id and maps only to tests that exist', () => {
  const ids = DESIGN_REQUIREMENTS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const testIds = new Set(cases.map((c) => c.id));
  for (const d of DESIGN_REQUIREMENTS) for (const t of d.tests) assert.ok(testIds.has(t), `${d.id} names unknown test ${t}`);
});

test('docs/design-requirements.md matches src/design.js (run npm run design:doc)', () => {
  assert.equal(readFileSync(new URL('../docs/design-requirements.md', import.meta.url), 'utf8'), designDoc());
});

test('model coverage counts a requirement once, and only for tests that reached pass or fail', () => {
  const results = [
    { test_id: 'T-10', outcome: 'pass' }, { test_id: 'T-11', outcome: 'fail' }, // DR-01, counted once
    { test_id: 'T-16', outcome: 'error' }, // DR-12 not evaluated
    { test_id: 'T-29', outcome: 'skip' }, // DR-13 not evaluated
  ];
  const m = modelCoverage(results);
  assert.equal(m.covered, 1);
  assert.equal(m.total, DESIGN_REQUIREMENTS.length);
  assert.match(m.basis, /DR-12/);
});
