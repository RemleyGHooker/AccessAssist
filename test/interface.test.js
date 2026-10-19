// Checks the course cross-team testing interface on both services:
// system /test/setup + /test/report, and tester /test/setup + /test/run + /test/report.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { cases } from '../src/cases.js';

let server;
let root;

const post = (path, body) => fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('system setup returns 201 with the same id, 409 on reuse, 400 without an id', async () => {
  const ok = await post('/system/test/setup', { session_id: 'abc-1', setup: {} });
  assert.equal(ok.status, 201);
  assert.deepEqual(await ok.json(), { session_id: 'abc-1' });
  assert.equal((await post('/system/test/setup', { session_id: 'abc-1', setup: {} })).status, 409);
  const bad = await post('/system/test/setup', { setup: {} });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).source, 'system');
});

test('system report returns coverage for a known session and 404 for an unknown one', async () => {
  await post('/system/test/setup', { session_id: 'abc-2', setup: {} });
  const r = await fetch(`${root}/system/test/report?session_id=abc-2`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.session_id, 'abc-2');
  assert.ok(body.coverage.code.basis.length > 0);
  assert.equal((await fetch(`${root}/system/test/report?session_id=nope`)).status, 404);
});

test('tester runs the whole suite against our own system and stores one report', async () => {
  const setup = await post('/tester/test/setup', { target_url: `${root}/system` });
  assert.equal(setup.status, 201);
  const { session_id } = await setup.json();
  assert.ok(session_id);

  assert.equal((await fetch(`${root}/tester/test/report?session_id=${session_id}`)).status, 409, 'report before run');

  const run = await post('/tester/test/run', { session_id });
  assert.equal(run.status, 200);
  const report = await run.json();
  assert.equal(report.results.length, cases.length, 'every planned test appears exactly once');
  assert.equal(new Set(report.results.map((r) => r.test_id)).size, cases.length);
  for (const r of report.results) {
    assert.ok(['pass', 'fail', 'error', 'skip'].includes(r.outcome));
    assert.ok(r.message.length > 0);
    assert.notEqual(r.outcome, 'fail', `${r.test_id}: ${r.message}`);
  }
  for (const key of ['code', 'component', 'system']) assert.ok(report.coverage[key].basis.length > 0);

  assert.equal((await post('/tester/test/run', { session_id })).status, 409, 'a session runs once');
  const stored = await fetch(`${root}/tester/test/report?session_id=${session_id}`);
  assert.deepEqual(await stored.json(), report);
});

test('tester rejects a bad target_url and forwards an unreachable target as a communication error', async () => {
  assert.equal((await post('/tester/test/setup', { target_url: 'not a url' })).status, 400);
  const r = await post('/tester/test/setup', { target_url: 'http://127.0.0.1:1/system' });
  assert.equal(r.status, 500);
  assert.equal((await r.json()).source, 'communication');
});

test('the upload page is served at the root', async () => {
  const r = await fetch(`${root}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /AccessAssist/);
});

test('the system and tester base URLs list their endpoints', async () => {
  for (const path of ['/system', '/tester']) {
    const r = await fetch(`${root}${path}`);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).endpoints.length > 0);
  }
});

test('unknown paths still answer in JSON', async () => {
  const r = await fetch(`${root}/nope`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'NOT_FOUND');
});
