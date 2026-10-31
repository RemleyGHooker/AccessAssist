import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHtml } from '../src/checks/html.js';
import { checkPdf } from '../src/checks/pdf.js';
import { checkDocx } from '../src/checks/docx.js';
import { contrastRatio } from '../src/checks/common.js';
import { html, fixtures, makeDocx } from '../src/fixtures.js';
import { UnprocessableFileError } from '../src/errors.js';
import { zipSync, strToU8 } from 'fflate';

const htmlResult = (body, level = 'AA', head = '') => checkHtml(Buffer.from(html(body, undefined, head)), level);
const criteria = (result) => result.issues.map((i) => i.wcag_criterion);

test('H-01 contrast oracles: black/white 21:1, identical colors 1:1, 4.5 boundary', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([80, 80, 80], [80, 80, 80]), 1);
  assert.ok(contrastRatio([118, 118, 118], [255, 255, 255]) > 4.5);
  assert.ok(contrastRatio([119, 119, 119], [255, 255, 255]) < 4.5);
  assert.ok(criteria(htmlResult('<p style="color:#777;background:#fff;font-size:16px">Text</p>')).includes('1.4.3'));
  assert.ok(!criteria(htmlResult('<p style="color:#767676;background:#fff;font-size:16px">Text</p>')).includes('1.4.3'));
});

test('H-02 large text uses 3:1 and AA checks are excluded at level A', () => {
  const body = '<p style="color:#888;background:#fff;font-size:24px">Large text</p>';
  assert.ok(!criteria(htmlResult(body)).includes('1.4.3'));
  assert.ok(criteria(htmlResult(body.replace('24px', '16px'))).includes('1.4.3'));
  assert.ok(!criteria(htmlResult(body.replace('24px', '16px'), 'A')).includes('1.4.3'));
});

test('H-03 DOM checks ignore comment images, decorative and hidden images; data-alt is not alt', () => {
  const result = htmlResult('<!-- <img src="fake"> --><img alt="" src="decoration"><img hidden src="hidden"><img data-alt="not an alternative" src="chart">');
  const images = result.issues.filter((i) => i.wcag_criterion === '1.1.1');
  assert.equal(images.length, 1);
  assert.match(images[0].location.snippet, /data-alt/);
  assert.equal(images[0].location.line, 5);
});

test('H-04 native and ARIA labels pass; broken label references and unnamed controls fail', () => {
  assert.equal(htmlResult('<label for="name">Name</label><input id="name"><button aria-label="Send"></button><a href="/">Home</a>').issues.length, 0);
  const result = htmlResult('<input aria-labelledby="does-not-exist"><button></button>');
  assert.ok(criteria(result).includes('1.3.1'));
  assert.ok(criteria(result).includes('4.1.2'));
  assert.equal(criteria(htmlResult('<select><option>Choice</option></select><textarea>Default value</textarea>')).filter((c) => c === '1.3.1').length, 2);
});

test('H-05 document language/title and custom heading levels have exact criterion mappings', () => {
  const result = checkHtml(Buffer.from('<html lang=""><head><title> </title></head><body><div role="heading" aria-level="0">Topic</div></body></html>'), 'AA');
  assert.deepEqual(new Set(criteria(result)), new Set(['3.1.1', '2.4.2', '1.3.1']));
});

test('H-06 scripts cannot execute and external CSS is not fetched', () => {
  const result = htmlResult('<script>throw new Error("uploaded script executed")</script><p>Text</p>', 'AA', '<link rel="stylesheet" href="http://127.0.0.1:1/blocked.css">');
  assert.equal(result.issues.length, 0);
  assert.match(result.scope, /external CSS/);
});

test('H-07 static style blocks and inherited backgrounds are checked; gradients are left for review', () => {
  assert.ok(criteria(htmlResult('<div class="bg"><span style="color:#aaa">Text</span></div>', 'AA', '<style>.bg {background-color:white}</style>')).includes('1.4.3'));
  assert.ok(!criteria(htmlResult('<p style="background-image:linear-gradient(white, black);color:#aaa">Text</p>')).includes('1.4.3'));
});

test('P-01 real tagged PDF fixture has an image, a structure tree, and no supported violations', async () => {
  assert.match(fixtures.validPdf.data.toString('latin1'), /\/Subtype \/Image/);
  assert.match(fixtures.validPdf.data.toString('latin1'), /\/StructTreeRoot/);
  const result = await checkPdf(fixtures.validPdf.data);
  assert.equal(result.issues.length, 0);
  assert.ok(result.checks_run.includes('1.1.1'));
});

test('P-02 PDF alternate-text defect has exact criterion and page, plus a concrete fix', async () => {
  const result = await checkPdf(fixtures.missingAltPdf.data);
  assert.deepEqual(criteria(result), ['1.1.1']);
  assert.equal(result.issues[0].location.page, 1);
  assert.match(result.issues[0].suggested_fix, /Figure tag/);
});

test('P-03 untagged PDF is not reported as clean and does not claim an image check ran', async () => {
  const result = await checkPdf(fixtures.untaggedPdf.data);
  assert.deepEqual(new Set(criteria(result)), new Set(['1.3.1', '2.4.2', '3.1.1']));
  assert.ok(!result.checks_run.includes('1.1.1'));
});

test('P-04 forged PDF fails real parsing', async () => {
  await assert.rejects(checkPdf(fixtures.fakePdf.data), UnprocessableFileError);
});

test('D-01 valid Word package and decorative picture have no supported violations', async () => {
  assert.equal((await checkDocx(fixtures.validDocx.data)).issues.length, 0);
  assert.equal((await checkDocx(makeDocx({ alt: null, decorative: true }))).issues.length, 0);
});

test('D-02 Word picture defect maps exactly to 1.1.1 with an XML location', async () => {
  const result = await checkDocx(fixtures.missingAltDocx.data);
  assert.deepEqual(criteria(result), ['1.1.1']);
  assert.equal(result.issues[0].location.selector, 'word/document.xml:drawing[1]');
});

test('D-03 missing Word language and empty marked header have exact mappings', async () => {
  const result = await checkDocx(makeDocx({ language: '', emptyHeader: true }));
  assert.deepEqual(new Set(criteria(result)), new Set(['3.1.1', '1.3.1']));
});

test('D-04 broken ZIP/XML, forbidden DTD, and excessive expanded XML are rejected', async () => {
  await assert.rejects(checkDocx(Buffer.from('PK\x03\x04word/document.xml')), UnprocessableFileError);
  await assert.rejects(checkDocx(fixtures.malformedDocx.data), UnprocessableFileError);
  const dtd = zipSync({ '[Content_Types].xml': strToU8('<!DOCTYPE a [<!ENTITY x "boom">]><a/>') });
  await assert.rejects(checkDocx(Buffer.from(dtd)), UnprocessableFileError);
  const oversized = zipSync({ 'word/document.xml': new Uint8Array(20 * 1024 * 1024 + 1) });
  await assert.rejects(checkDocx(Buffer.from(oversized)), UnprocessableFileError);
});
