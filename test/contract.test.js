// Runs the Team 19 suite (src/cases.js) with node:test.
// Default: against a fresh in-process server. Set BASE_URL to run it against a deployed
// system instead, e.g. BASE_URL=https://<service>.run.app/system npm run test:remote

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cases, runCase } from '../src/cases.js';
import { createApp } from '../src/app.js';

const remote = process.env.BASE_URL;
let server;
let base = remote;

before(async () => {
  if (remote) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/system`;
});

after(() => server?.close());

for (const c of cases) {
  const skip = c.local && remote ? 'needs fault injection; runs only against the local server' : false;
  test(`${c.id} ${c.name} [${c.ac.join(', ')}]`, { skip }, async (t) => {
    if (c.local) process.env.SIMULATE_DEPENDENCY_FAILURE = 'true';
    try {
      const r = await runCase(c, base);
      if (r.outcome === 'skip') return t.skip(r.message);
      assert.equal(r.outcome, 'pass', r.message);
    } finally {
      delete process.env.SIMULATE_DEPENDENCY_FAILURE;
    }
  });
}
