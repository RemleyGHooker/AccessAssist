import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

function page() {
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' });
  dom.window.eval(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'));
  return dom;
}

test('U-01 report renders PDF page locations, scope and escaped snippets, with JSON export available', () => {
  const dom = page();
  try {
    dom.window.render(200, { checks_run: ['1.1.1'], message: 'Manual review remains necessary.', issues: [{ wcag_criterion: '1.1.1', severity: 'critical', description: 'Missing alternate text', suggested_fix: 'Add text.', location: { page: 2, snippet: '<img src=x onerror=alert(1)>' } }] });
    const result = dom.window.document.getElementById('results');
    assert.match(result.textContent, /Page 2/);
    assert.match(result.textContent, /Manual review/);
    assert.equal(result.querySelectorAll('img').length, 0);
    assert.equal(dom.window.document.getElementById('download').hidden, false);
  } finally { dom.window.close(); }
});

test('U-02 dependency error hides report download and never displays a clean result', () => {
  const dom = page();
  try {
    dom.window.render(503, { code: 'PROCESSING_UNAVAILABLE', message: 'Try again.' });
    assert.equal(dom.window.document.getElementById('download').hidden, true);
    assert.match(dom.window.document.getElementById('status').textContent, /Not checked/);
    assert.match(dom.window.document.getElementById('results').textContent, /No complete report/);
  } finally { dom.window.close(); }
});
