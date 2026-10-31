import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remediate } from '../src/remediation.js';
import { DependencyUnavailableError } from '../src/errors.js';

const input = [{ wcag_criterion: '1.1.1', location: { snippet: 'PRIVATE_UPLOAD_CONTENT', line: 5 }, severity: 'critical', description: 'An image has no text alternative.', suggested_fix: 'Add meaningful alternate text that describes the purpose of the image.' }];
const response = (suggestions) => Response.json({ choices: [{ message: { content: JSON.stringify({ suggestions }) } }] });
const options = (fetchImpl) => ({ mode: 'groq', apiKey: 'test-key-not-a-real-secret', fetchImpl });

test('G-01 deterministic mode provides concrete guidance without contacting a provider', async () => {
  const result = await remediate(input, { mode: 'deterministic', fetchImpl: () => { throw new Error('must not call'); } });
  assert.deepEqual(result, input);
});

test('G-02 valid provider guidance preserves deterministic findings and excludes private upload content', async () => {
  let called = false;
  const result = await remediate(input, options(async (url, init) => {
    called = true;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.doesNotMatch(init.body, /PRIVATE_UPLOAD_CONTENT|snippet/);
    assert.equal(JSON.parse(init.body).response_format.type, 'json_object');
    return response([{ id: 0, text: 'Open the image settings and enter a concise description of its purpose.' }]);
  }));
  assert.ok(called);
  assert.equal(result[0].wcag_criterion, '1.1.1');
  assert.deepEqual(result[0].location, input[0].location);
  assert.ok(result[0].suggested_fix.startsWith(input[0].suggested_fix));
  assert.match(result[0].suggested_fix, /AI-generated; review before use/);
});

test('G-03 missing credentials and invalid mode fail explicitly', async () => {
  await assert.rejects(remediate(input, { mode: 'groq', apiKey: '' }), DependencyUnavailableError);
  await assert.rejects(remediate(input, { mode: 'other' }), DependencyUnavailableError);
});

test('G-04 provider 429, 503, malformed JSON, incomplete IDs and duplicate IDs never return partial findings', async () => {
  const two = [...input, { ...input[0], wcag_criterion: '3.1.1', suggested_fix: 'Set the default document language.' }];
  for (const fake of [
    () => new Response('rate limit', { status: 429 }),
    () => new Response('unavailable', { status: 503 }),
    () => new Response('invalid json'),
    () => response([]),
    () => response([{ id: 0, text: 'Set the alternative text correctly.' }, { id: 0, text: 'Set the document language correctly.' }]),
    () => response([{ id: 0, text: 'short' }, { id: 1, text: 'Set the document language correctly.' }]),
  ]) await assert.rejects(remediate(two, options(async () => fake())), DependencyUnavailableError);
});

test('G-05 provider timeout aborts the request', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout did not abort')), 1000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
  await assert.rejects(remediate(input, { ...options(fetchImpl), timeoutMs: 20 }), DependencyUnavailableError);
});

test('G-06 duplicate findings share one request; empty results require no provider call', async () => {
  let count;
  await remediate([...input, ...input], options(async (_url, init) => {
    count = JSON.parse(JSON.parse(init.body).messages[1].content).length;
    return response([{ id: 0, text: 'Describe the image purpose using concise alternate text.' }]);
  }));
  assert.equal(count, 1);
  assert.deepEqual(await remediate([], { mode: 'groq', apiKey: '' }), []);
});
