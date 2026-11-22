// Runs the Team 19 suite (src/cases.js) with node:test.
// Default: against a fresh in-process server. Set BASE_URL to run it against a deployed
// system instead, e.g. BASE_URL=https://<service>.run.app/system npm run test:remote
// Set OWN_SYSTEM=true when BASE_URL is our own deployed system, so the Team 19 design checks
// (fault injection, checks_run, no-store) run too; against other teams they are skipped.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cases, runCase } from '../src/cases.js';
import { createApp } from '../src/app.js';

// Keeps request logs out of test output (src/app.js reads this per request). Set here rather
// than in the npm script so `npm test` works the same in bash, PowerShell and cmd.
process.env.NODE_ENV ??= 'test';

const remote = process.env.BASE_URL;
let server;
let base = remote;
const ctx = { sessionId: null, own: !remote || process.env.OWN_SYSTEM === 'true' };

before(async () => {
  if (!remote) {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/system`;
  }
  // Prepare a session through the course interface, as the deployed tester does.
  const id = randomUUID();
  const r = await fetch(`${base.replace(/\/$/, '')}/test/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: id, setup: {} }),
  });
  assert.equal(r.status, 201, `system setup failed: ${r.status} ${await r.text()}`);
  ctx.sessionId = id;
});

after(() => server?.close());

for (const c of cases) {
  test(`${c.id} ${c.name} [${c.ac.join(', ') || 'test interface'}]`, async (t) => {
    const r = await runCase(c, base, ctx);
    if (r.outcome === 'skip') return t.skip(r.message);
    assert.equal(r.outcome, 'pass', r.message);
  });
}
