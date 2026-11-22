// Checks the course cross-team testing interface on both services:
// system /test/setup + /test/report, and tester /test/setup + /test/run + /test/report,
// plus the Phase 5 behavior around them: coverage.model only for our own system, target_url
// checks (LIM-07), guarded fault injection (REQ-09), no retention (REQ-10) and live coverage.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { cases } from '../src/cases.js';
import { DESIGN_MAPPING_URL, DESIGN_REQUIREMENTS } from '../src/design.js';
import { checkTarget, isOwnSystem, isPrivateAddress } from '../src/targets.js';

// Keeps request logs out of test output (src/app.js reads this per request). Set here rather
// than in the npm script so `npm test` works the same in bash, PowerShell and cmd.
process.env.NODE_ENV ??= 'test';
// The local targets in these tests are on 127.0.0.1, which the tester refuses in production.
process.env.ALLOW_PRIVATE_TARGETS = 'true';

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

async function runTester(targetUrl) {
  const setup = await post('/tester/test/setup', { target_url: targetUrl });
  assert.equal(setup.status, 201, await setup.clone().text());
  const { session_id } = await setup.json();
  assert.ok(session_id);
  assert.equal((await fetch(`${root}/tester/test/report?session_id=${session_id}`)).status, 409, 'report before run');
  const run = await post('/tester/test/run', { session_id });
  assert.equal(run.status, 200);
  return { session_id, report: await run.json() };
}

function wellFormedReport(report) {
  assert.equal(report.results.length, cases.length, 'every planned test appears exactly once');
  assert.equal(new Set(report.results.map((r) => r.test_id)).size, cases.length);
  for (const r of report.results) {
    assert.ok(['pass', 'fail', 'error', 'skip'].includes(r.outcome));
    assert.ok(r.message.length > 0);
    if (r.outcome === 'error') assert.ok(['tester', 'system', 'communication', 'unknown'].includes(r.source));
    assert.notEqual(r.outcome, 'fail', `${r.test_id}: ${r.message}`);
  }
  for (const [key, m] of Object.entries(report.coverage)) {
    assert.ok(m.basis.length > 0, key);
    assert.ok((m.covered === null && m.total === null) || (Number.isInteger(m.covered) && m.covered >= 0 && m.covered <= m.total), key);
  }
}

test('tester against our own system: one stored report, Team 19 design checks run, and coverage.model is included', async () => {
  const { session_id, report } = await runTester(`${root}/system`);
  wellFormedReport(report);
  const byId = Object.fromEntries(report.results.map((r) => [r.test_id, r]));
  for (const id of ['T-16', 'T-29', 'T-32', 'T-34']) assert.equal(byId[id].outcome, 'pass', `${id}: ${byId[id].message}`);
  assert.deepEqual(Object.keys(report.coverage).sort(), ['code', 'component', 'model', 'system']);
  const { model } = report.coverage;
  assert.equal(model.total, DESIGN_REQUIREMENTS.length);
  assert.equal(model.covered, DESIGN_REQUIREMENTS.filter((d) => d.tests.length > 0).length, model.basis);
  assert.match(model.basis, /design v5\.0/);
  assert.ok(model.basis.includes(DESIGN_MAPPING_URL));
  assert.equal(report.coverage.component.covered, report.coverage.component.total, 'all pod components exercised');

  assert.equal((await post('/tester/test/run', { session_id })).status, 409, 'a session runs once');
  const stored = await fetch(`${root}/tester/test/report?session_id=${session_id}`);
  assert.deepEqual(await stored.json(), report);
});

test('tester against another team\'s system: coverage.model is omitted and Team 19 design checks are skipped', async () => {
  // A second copy of the system on another origin stands in for a podmate's service.
  const other = createApp().listen(0);
  await new Promise((r) => other.once('listening', r));
  try {
    const { report } = await runTester(`http://127.0.0.1:${other.address().port}/system`);
    wellFormedReport(report);
    assert.deepEqual(Object.keys(report.coverage).sort(), ['code', 'component', 'system']);
    for (const c of cases.filter((x) => x.own)) {
      const r = report.results.find((x) => x.test_id === c.id);
      assert.equal(r.outcome, 'skip', c.id);
      assert.match(r.message, /Team 19/);
    }
  } finally {
    other.close();
  }
});

test('tester rejects a bad target_url and forwards an unreachable target as a communication error', async () => {
  for (const target_url of ['not a url', 'ftp://example.com/system', 'https://user:pw@example.com/system', 'https://example.com/system?x=1', 'https://example.com/system#f']) {
    const r = await post('/tester/test/setup', { target_url });
    assert.equal(r.status, 400, target_url);
    assert.equal((await r.json()).source, 'tester');
  }
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

test('malformed JSON is labeled with the service that received it', async () => {
  for (const [path, source] of [['/tester/test/setup', 'tester'], ['/system/test/setup', 'system']]) {
    const r = await fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"oops"' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).source, source);
  }
});

test('a target that answers HTTP 500 is recorded as an error from the system, not a failed check', async () => {
  const { createServer } = await import('node:http');
  const broken = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url === '/test/setup') {
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ session_id: JSON.parse(body).session_id }));
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end('{"code":"INTERNAL_ERROR","message":"boom"}');
    });
  }).listen(0);
  await new Promise((r) => broken.once('listening', r));
  try {
    const setup = await post('/tester/test/setup', { target_url: `http://127.0.0.1:${broken.address().port}` });
    const { session_id } = await setup.json();
    const report = await (await post('/tester/test/run', { session_id })).json();
    const t01 = report.results.find((r) => r.test_id === 'T-01');
    assert.equal(t01.outcome, 'error');
    assert.equal(t01.source, 'system');
  } finally {
    broken.close();
  }
});

test('system report measures project lines run since setup; reading it changes nothing, later requests count', { skip: process.env.NODE_V8_COVERAGE ? 'c8 owns the V8 counters in this run' : false }, async () => {
  const report = async (id) => (await (await fetch(`${root}/system/test/report?session_id=${id}`)).json()).coverage.code;
  await post('/system/test/setup', { session_id: 'cov-1', setup: {} });
  assert.equal((await upload('a.html', 'text/html', MISSING_ALT)).status, 200);
  const first = await report('cov-1');
  assert.ok(Number.isInteger(first.covered) && Number.isInteger(first.total), JSON.stringify(first));
  assert.ok(first.covered > 0 && first.covered < first.total, `${first.covered}/${first.total}`);
  assert.deepEqual(await report('cov-1'), first, 'repeated reports agree');
  assert.ok(!first.basis.includes('test-interface.js') && first.basis.includes('system.js'));

  // A later session starts from zero even though cov-1 already read its report.
  await post('/system/test/setup', { session_id: 'cov-2', setup: {} });
  assert.equal((await report('cov-2')).covered < first.covered, true, 'a new session does not inherit earlier requests');

  // A PDF request runs code the HTML request did not: both sessions' reports rise (shared process).
  const { fixtures } = await import('../src/fixtures.js');
  assert.equal((await upload('h.pdf', 'application/pdf', fixtures.accessiblePdf.data)).status, 200);
  const later = await report('cov-1');
  assert.ok(later.covered > first.covered, `${later.covered} > ${first.covered}`);
  assert.equal(later.total, first.total);
});

test('tester refuses private, loopback and metadata targets unless ALLOW_PRIVATE_TARGETS is set (LIM-07)', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['8.8.8.8', '34.120.1.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(a), false, a);

  delete process.env.ALLOW_PRIVATE_TARGETS;
  try {
    for (const target_url of ['http://127.0.0.1:8080/system', 'http://169.254.169.254/computeMetadata', 'http://[::1]/system']) {
      const r = await post('/tester/test/setup', { target_url });
      assert.equal(r.status, 400, target_url);
      assert.match((await r.json()).message, /public pod system/);
    }
    // A host name that resolves to a private address is refused too (DNS answer is checked).
    const privateDns = async () => [{ address: '10.0.0.5', family: 4 }];
    assert.equal((await checkTarget('https://internal.example.com/system', { resolve: privateDns })).status, 400);
    const publicDns = async () => [{ address: '34.120.1.1', family: 4 }];
    assert.equal(await checkTarget('https://team20.example.com/system', { resolve: publicDns }), null);
    const noDns = async () => { throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' }); };
    assert.equal((await checkTarget('https://nowhere.example/system', { resolve: noDns })).source, 'communication');
  } finally {
    process.env.ALLOW_PRIVATE_TARGETS = 'true';
  }
  process.env.ALLOWED_TARGET_HOSTS = 'team20.example.com';
  try {
    assert.equal((await checkTarget('https://elsewhere.example.com/system')).status, 400);
  } finally {
    delete process.env.ALLOWED_TARGET_HOSTS;
  }
});

test('own-system detection matches the deployed URL and the tester\'s own origin only', () => {
  const req = { protocol: 'https', get: (h) => (h === 'host' ? 'accessassist-abc.a.run.app' : undefined) };
  assert.equal(isOwnSystem('https://accessassist-git-365255122806.europe-west1.run.app/system/', null), true);
  assert.equal(isOwnSystem('https://accessassist-abc.a.run.app/system', req), true);
  assert.equal(isOwnSystem('https://accessassist-abc.a.run.app/other', req), false);
  assert.equal(isOwnSystem('https://team20.onrender.com/system', req), false);
});

test('tester forwards a system setup failure with its status, message and source, and checks the returned id', async () => {
  const { createServer } = await import('node:http');
  let mode = 'fail';
  const fake = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (mode === 'fail') { res.statusCode = 500; return res.end('{"message":"Could not initialize the session database.","source":"system"}'); }
      res.statusCode = 201;
      return res.end(JSON.stringify({ session_id: mode === 'wrong-id' ? 'other' : JSON.parse(body).session_id }));
    });
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  const target_url = `http://127.0.0.1:${fake.address().port}`;
  try {
    const failed = await post('/tester/test/setup', { target_url });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { message: 'Could not initialize the session database.', source: 'system' });
    mode = 'wrong-id';
    const wrong = await post('/tester/test/setup', { target_url });
    assert.equal(wrong.status, 500);
    assert.equal((await wrong.json()).source, 'system');
  } finally {
    fake.close();
  }
});

// ---------- Phase 5: system side ----------

function upload(name, type, data, headers = {}) {
  const form = new FormData();
  form.append('file', new Blob([data], { type }), name);
  return fetch(`${root}/system/analyze`, { method: 'POST', body: form, headers });
}
const MISSING_ALT = '<!doctype html><html lang="en"><head><title>T</title></head><body><h1>x</h1><img src="a.png"></body></html>';

test('fault injection needs a live test session, rejects unknown faults, and can be switched off (REQ-09)', async () => {
  await post('/system/test/setup', { session_id: 'fault-1', setup: {} });
  // No session, or an unknown one: the header is ignored and the upload is evaluated normally.
  assert.equal((await upload('a.html', 'text/html', MISSING_ALT, { 'X-Test-Fault': 'dependency-unavailable' })).status, 200);
  assert.equal((await upload('a.html', 'text/html', MISSING_ALT, { 'X-Test-Fault': 'dependency-unavailable', 'X-Test-Session': 'nope' })).status, 200);
  const bad = await upload('a.html', 'text/html', MISSING_ALT, { 'X-Test-Fault': 'explode', 'X-Test-Session': 'fault-1' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_TEST_FAULT');
  for (const fault of ['dependency-unavailable', 'evaluation-crash']) {
    const r = await upload('a.html', 'text/html', MISSING_ALT, { 'X-Test-Fault': fault, 'X-Test-Session': 'fault-1' });
    assert.equal(r.status, 503, fault);
    const body = await r.json();
    assert.equal(body.code, 'PROCESSING_UNAVAILABLE');
    assert.equal('issues' in body, false, 'no partial results');
  }
  process.env.FAULT_INJECTION = 'off';
  try {
    assert.equal((await upload('a.html', 'text/html', MISSING_ALT, { 'X-Test-Fault': 'evaluation-crash', 'X-Test-Session': 'fault-1' })).status, 200);
  } finally {
    delete process.env.FAULT_INJECTION;
  }
});

test('an over-complex HTML page gets 422 with the reason, not a crash (REQ-12, LIM-04)', async () => {
  const r = await upload('deep.html', 'text/html', '<!doctype html><html><body>' + '<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000) + '</body></html>');
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.code, 'UNPROCESSABLE_FILE');
  assert.match(body.message, /^The file could not be evaluated: elements are nested 5,00\d levels deep/);
});

test('uploads leave no files behind and answers are not cacheable (REQ-10)', async () => {
  const before = new Set(readdirSync(tmpdir()));
  const marker = `secret-${Date.now()}`;
  for (const [name, type] of [['a.html', 'text/html'], ['b.html', 'text/html']]) {
    const r = await upload(name, type, MISSING_ALT.replace('<h1>x</h1>', `<h1>${marker}</h1>`));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await r.text()).includes(marker), false, 'the file content is not echoed back');
  }
  const created = readdirSync(tmpdir()).filter((f) => !before.has(f));
  assert.deepEqual(created, [], 'no temporary files were created');
});

test('system setup rejects a setup value that is not an object', async () => {
  const r = await post('/system/test/setup', { session_id: 'bad-setup', setup: 'x' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).source, 'system');
});
