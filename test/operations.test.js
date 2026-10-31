import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { validateResponse } from '../src/contract.js';
import { DependencyUnavailableError } from '../src/errors.js';
import { fixtures } from '../src/fixtures.js';

const schema = (method, path, result) => {
  const check = validateResponse(method, path, result.status, result.body);
  assert.ok(check.valid, check.message);
};

test('O-01 every common operation has schema-conforming success and defined test-interface error responses', async () => {
  const app = createApp();
  for (const path of ['/health', '/formats']) schema('GET', path, await request(app).get(`/system${path}`));
  const setup = await request(app).post('/system/test/setup').send({ session_id: 'conformance' });
  schema('POST', '/test/setup', setup);
  schema('POST', '/test/setup', await request(app).post('/system/test/setup').send({ session_id: 'conformance' }));
  schema('POST', '/test/setup', await request(app).post('/system/test/setup').send({}));
  for (const query of ['?session_id=conformance', '?session_id=unknown', '']) {
    schema('GET', '/test/report', await request(app).get(`/system/test/report${query}`));
  }
});

test('O-02 invalid request JSON identifies the correct system or tester source', async () => {
  for (const source of ['system', 'tester']) {
    const r = await request(createApp()).post(`/${source}/test/setup`).set('content-type', 'application/json').send('{');
    assert.equal(r.status, 400);
    assert.equal(r.body.source, source);
  }
});

test('O-03 buffers are overwritten and released after analysis success or dependency failure', async () => {
  for (const failure of [false, true]) {
    let captured;
    const app = createApp({ analyzeDocument: async ({ buffer }) => {
      captured = buffer;
      assert.ok(buffer.some((v) => v !== 0));
      if (failure) throw new DependencyUnavailableError('Injected provider failure');
      return { issues: [], checks_run: ['1.1.1'], message: 'No supported violations were detected.' };
    } });
    const r = await request(app).post('/system/analyze').attach('file', fixtures.accessibleHtml.data, { filename: 'private.html', contentType: 'text/html' });
    assert.equal(r.status, failure ? 503 : 200);
    assert.ok(captured.every((v) => v === 0));
    if (failure) assert.ok(!('issues' in r.body));
  }
});

test('O-04 unexpected analyzer failure returns contract 503 and keeps upload content out of logs', async () => {
  let captured;
  const logs = [];
  const app = createApp({ logger: (entry) => logs.push(entry), analyzeDocument: async ({ buffer }) => {
    captured = buffer;
    throw new Error('PRIVATE_UPLOAD_CONTENT');
  } });
  const r = await request(app).post('/system/analyze').attach('file', fixtures.accessibleHtml.data, { filename: 'private.html', contentType: 'text/html' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'PROCESSING_UNAVAILABLE');
  assert.ok(captured.every((v) => v === 0));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 503);
  assert.equal(logs[0].error_code, 'PROCESSING_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_UPLOAD_CONTENT|private.html|Campus map/);
});

test('O-05 JSON Schema catches missing issue fields and invalid page types', () => {
  assert.equal(validateResponse('POST', '/analyze', 200, { issues: [{ wcag_criterion: '1.1.1' }] }).valid, false);
  assert.equal(validateResponse('POST', '/analyze', 200, { issues: [{ wcag_criterion: '1.1.1', location: { page: 'one' }, severity: 'critical', description: 'x', suggested_fix: 'x' }] }).valid, false);
});

test('O-06 a document exceeding the finding budget fails with 503 instead of a truncated report', async () => {
  const data = Buffer.from('<html lang="en"><head><title>Many images</title></head><body>' + '<img src="x">'.repeat(1001) + '</body></html>');
  const r = await request(createApp()).post('/system/analyze').attach('file', data, { filename: 'many.html', contentType: 'text/html' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'PROCESSING_UNAVAILABLE');
  assert.ok(!('issues' in r.body));
});
