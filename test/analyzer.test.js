// Unit tests for the Phase 4 rule sets (src/checks/*), the WCAG level filter, and the
// optional Groq remediation step. Each input has one known property; expected outputs come
// from the WCAG 2.1 success criteria and W3C techniques, not from our own output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { analyze, NO_VIOLATIONS, UnprocessableFileError } from '../src/analyzer.js';
import { contrastRatio, parseColor, requiredRatio } from '../src/checks/contrast.js';
import { shrinkLongRuns } from '../src/checks/html.js';
import { builders } from '../src/fixtures.js';
import { improveFixes } from '../src/remediation.js';

const HTML = 'text/html';
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const run = (mime, data, wcagLevel = 'AA') => analyze({ mime, buffer: Buffer.isBuffer(data) ? data : Buffer.from(data), wcagLevel });
const page = (body, extra = {}) => builders.html(body, extra.lang ?? ' lang="en"', extra.title ?? '<title>T</title>', extra.style ?? '');
const criteria = (r) => r.issues.map((i) => i.wcag_criterion);

// ---------- contrast math (WCAG 2.1 definitions) ----------

test('contrast ratio matches the WCAG formula at known points', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00');
  assert.equal(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]).toFixed(2), '4.54'); // lightest gray that passes
  assert.ok(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]) < 4.5);
  assert.equal(requiredRatio(16, false), 4.5);
  assert.equal(requiredRatio(24, false), 3); // 18pt
  assert.equal(requiredRatio(18.67, true), 3); // 14pt bold
  assert.equal(requiredRatio(18.67, false), 4.5);
});

test('colors that cannot be known for certain are not guessed', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.equal(parseColor('rgba(0,0,0,0.5)'), null);
  assert.equal(parseColor('var(--text)'), null);
  assert.equal(parseColor('#00000080'), null);
});

// ---------- HTML ----------

test('HTML: large text only needs 3:1, normal text needs 4.5:1', async () => {
  const r = await run(HTML, page('<h1>Course</h1><p style="color:#949494;font-size:24px">Big gray</p><p style="color:#949494">Small gray</p>'));
  assert.deepEqual(criteria(r), ['1.4.3']);
  assert.match(r.issues[0].location.snippet, /color:#949494">$/);
  assert.equal(r.issues[0].location.selector, 'body > p:nth-of-type(2)');
});

test('HTML: stylesheet rules, inheritance and backgrounds feed the contrast check', async () => {
  const style = '<style>.panel { background-color: #222; } .panel p { color: #444; } .panel .ok { color: #fff; }</style>';
  const r = await run(HTML, page('<h1>T</h1><div class="panel"><p>dark on dark</p><p class="ok">white on dark</p></div>', { style }));
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0].description, /#444444 on background #222222/);
});

test('HTML: background images and hidden text are skipped instead of guessed', async () => {
  const r = await run(HTML, page('<h1>T</h1><div style="background:url(x.png)"><p style="color:#eee">on image</p></div><p hidden style="color:#eee">hidden</p>'));
  assert.deepEqual(r.issues, []);
});

test('HTML: decorative and named images pass; image buttons, areas and svg need names', async () => {
  const ok = await run(HTML, page('<h1>T</h1><img src="a.png" alt=""><img src="b.png" role="presentation"><img src="c.png" aria-label="Logo of Purdue">'));
  assert.deepEqual(ok.issues, []);
  const bad = await run(HTML, page('<h1>T</h1><input type="image" src="go.png"><map name="m"><area href="/a"></map><svg role="img"></svg><img src="d.png" alt="IMG_2041.jpg">'));
  assert.deepEqual(criteria(bad), ['1.1.1', '1.1.1', '1.1.1', '1.1.1']);
  assert.deepEqual(bad.issues.map((i) => i.severity), ['moderate', 'critical', 'critical', 'serious']);
});

test('HTML: labelled controls pass, unnamed buttons and untitled iframes fail under 4.1.2', async () => {
  const ok = await run(HTML, page('<h1>T</h1><label>Name <input></label><input aria-label="Search"><button aria-label="Close"></button><iframe title="Lecture video" src="v"></iframe>'));
  assert.deepEqual(ok.issues, []);
  const bad = await run(HTML, page('<h1>T</h1><select></select><button><span></span></button><iframe src="v"></iframe>'));
  assert.deepEqual(criteria(bad), ['4.1.2', '4.1.2', '4.1.2']);
});

test('HTML: invalid lang codes and empty titles are reported', async () => {
  const r = await run(HTML, page('<h1>T</h1>', { lang: ' lang="english language"', title: '<title> </title>' }));
  assert.deepEqual(criteria(r).sort(), ['2.4.2', '3.1.1']);
});

test('HTML: one-row and layout tables need no headers', async () => {
  const r = await run(HTML, page('<h1>T</h1><table><tr><td>a</td></tr></table><table role="presentation"><tr><td>a</td></tr><tr><td>b</td></tr></table>'));
  assert.deepEqual(r.issues, []);
});

test('HTML: very long comments, base64 images and padding are cut before parsing, with locations kept', async () => {
  const pad = 'x'.repeat(200_000);
  const b64 = 'QUJD'.repeat(100_000);
  const spaces = ' '.repeat(50_000);
  const src = `<!doctype html>\n<html lang="en"><head><title>T</title></head><body><!--${pad}-->\n`
    + `<img src="data:image/png;base64,${b64}" alt="Logo of the course">${spaces}<p>text</p>\n`
    + '<img src="a.png" id="late"></body></html>';
  const { shrunk, toOriginal } = shrinkLongRuns(src);
  assert.ok(shrunk.length < 1000);
  const at = shrunk.indexOf('<img src="a.png"');
  assert.equal(toOriginal(at), src.indexOf('<img src="a.png"'));
  const r = await run(HTML, src);
  assert.deepEqual(criteria(r), ['1.1.1']); // the base64 image keeps its alt; only the late image fails
  assert.equal(r.issues[0].location.line, 4);
  assert.equal(r.issues[0].location.snippet, '<img src="a.png" id="late">');
  assert.equal(shrinkLongRuns('<p>short</p>').shrunk, '<p>short</p>');
});

test('wcag_level=A runs only Level A criteria and says which ones ran', async () => {
  const body = page('<h1>T</h1><p style="color:#bbb">faint</p><img src="x.png">');
  const aa = await run(HTML, body, 'AA');
  const a = await run(HTML, body, 'A');
  assert.ok(aa.checks_run.includes('1.4.3'));
  assert.ok(!a.checks_run.includes('1.4.3'));
  assert.deepEqual(criteria(a), ['1.1.1']);
  assert.equal(a.wcag_level, 'A');
});

test('a clean result always carries the explicit no-violations message (REQ-08)', async () => {
  const r = await run(HTML, page('<h1>T</h1><p>Hello</p>'));
  assert.equal(r.no_violations_detected, true);
  assert.equal(r.message, NO_VIOLATIONS);
  assert.ok(r.checks_run.length >= 7);
});

// ---------- PDF ----------

test('PDF: scanned pages (images, no text) are reported under 1.4.5', async () => {
  const r = await run(PDF, builders.coursePdf({ text: false }));
  assert.deepEqual(criteria(r), ['1.4.5']);
  assert.equal(r.issues[0].location.page, 1);
});

test('PDF: missing language and title are reported; title without DisplayDocTitle is minor', async () => {
  const r = await run(PDF, builders.coursePdf({ lang: null, title: null }));
  assert.deepEqual(criteria(r).sort(), ['2.4.2', '3.1.1']);

  const doc = await PDFDocument.load(builders.coursePdf());
  doc.catalog.delete(PDFName.of('ViewerPreferences'));
  const r2 = await run(PDF, Buffer.from(await doc.save()));
  assert.deepEqual(criteria(r2), ['2.4.2']);
  assert.equal(r2.issues[0].severity, 'minor');
});

test('PDF: tables without TH cells and unnamed form fields are reported', async () => {
  const doc = await PDFDocument.load(builders.coursePdf());
  const ctx = doc.context;
  const table = ctx.obj({ Type: 'StructElem', S: 'Table', K: [ctx.obj({ Type: 'StructElem', S: 'TR', K: [ctx.obj({ Type: 'StructElem', S: 'TD' })] })] });
  const tableRef = ctx.register(table);
  const docElem = doc.catalog.lookup(PDFName.of('StructTreeRoot')).lookup(PDFName.of('K'));
  docElem.lookup(PDFName.of('K')).push(tableRef);
  const field = doc.getForm().createTextField('student_id');
  field.addToPage(doc.getPages()[0], { x: 72, y: 300 });
  const r = await run(PDF, Buffer.from(await doc.save()));
  assert.deepEqual(criteria(r).sort(), ['1.3.1', '4.1.2']);
  assert.equal(r.issues.find((i) => i.wcag_criterion === '4.1.2').location.page, 1);

  field.acroField.dict.set(PDFName.of('TU'), PDFString.of('Student ID number'));
  const named = await run(PDF, Buffer.from(await doc.save()));
  assert.deepEqual(criteria(named), ['1.3.1']);
});

test('PDF: custom tags mapped to Figure through the RoleMap still need alt text', async () => {
  const doc = await PDFDocument.load(builders.coursePdf({ figureAlt: null }));
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  root.set(PDFName.of('RoleMap'), doc.context.obj({ Diagram: 'Figure' }));
  const fig = root.lookup(PDFName.of('K')).lookup(PDFName.of('K')).lookup(2);
  fig.set(PDFName.of('S'), PDFName.of('Diagram'));
  const r = await run(PDF, Buffer.from(await doc.save()));
  assert.deepEqual(criteria(r), ['1.1.1']);
});

test('PDF: a file with no document catalog is unprocessable, not a pass', async () => {
  await assert.rejects(run(PDF, '%PDF-1.4\ngarbage only\n%%EOF\n'), UnprocessableFileError);
});

// ---------- Word ----------

async function docx(bodyXml, { lang = 'en-US', title = 'T' } = {}) {
  const { strToU8, zipSync } = await import('fflate');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return Buffer.from(zipSync({
    'word/document.xml': strToU8(`<w:document ${W}><w:body>${bodyXml}</w:body></w:document>`),
    'word/styles.xml': strToU8(`<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/>${lang ? `<w:lang w:val="${lang}"/>` : ''}</w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading3"><w:name w:val="heading 3"/></w:style></w:styles>`),
    'docProps/core.xml': strToU8(`<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/">${title ? `<dc:title>${title}</dc:title>` : ''}</cp:coreProperties>`),
  }));
}
const p = (text, { style, rPr = '' } = {}) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:rPr>${rPr}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;

test('Word: the standard fixture variants each fail exactly one criterion', async () => {
  assert.deepEqual(criteria(await run(DOCX, builders.courseDocx())), []);
  assert.deepEqual(criteria(await run(DOCX, builders.courseDocx({ title: null }))), ['2.4.2']);
  assert.deepEqual(criteria(await run(DOCX, builders.courseDocx({ lang: null }))), ['3.1.1']);
  assert.deepEqual(criteria(await run(DOCX, builders.courseDocx({ headerRow: false }))), ['1.3.1']);
});

test('Word: skipped heading levels and hand-formatted headings are reported under 1.3.1', async () => {
  const skip = await run(DOCX, await docx(p('Course', { style: 'Heading1' }) + p('Grading', { style: 'Heading3' })));
  assert.deepEqual(criteria(skip), ['1.3.1']);
  assert.match(skip.issues[0].description, /from 1 to 3/);

  const fake = await run(DOCX, await docx(p('Grading Policy', { rPr: '<w:b/>' }) + p('Exams count for half of the grade.')));
  assert.deepEqual(criteria(fake), ['1.3.1']);
  assert.match(fake.issues[0].description, /no Heading styles/);
});

test('Word: light text colors are reported under 1.4.3, highlighted backgrounds are used', async () => {
  const r = await run(DOCX, await docx(
    p('Course', { style: 'Heading1' })
    + p('Faint note', { rPr: '<w:color w:val="BFBFBF"/>' })
    + p('Readable on yellow', { rPr: '<w:color w:val="000000"/><w:highlight w:val="yellow"/>' })
    + p('White on yellow', { rPr: '<w:color w:val="FFFFFF"/><w:highlight w:val="yellow"/>' }),
  ));
  assert.deepEqual(criteria(r), ['1.4.3', '1.4.3']);
  assert.match(r.issues[1].description, /#ffffff on background #ffff00/);
});

test('Word: vague and empty link text is reported under 2.4.4', async () => {
  const link = (t) => `<w:p><w:hyperlink><w:r><w:t>${t}</w:t></w:r></w:hyperlink></w:p>`;
  const r = await run(DOCX, await docx(p('Links', { style: 'Heading1' }) + link('click here') + link('') + link('Week 1 slides')));
  assert.deepEqual(criteria(r), ['2.4.4', '2.4.4']);
  assert.deepEqual(r.issues.map((i) => i.severity), ['moderate', 'serious']);
});

test('Word: images marked decorative need no alt text; charts do', async () => {
  const drawing = (uri, docPr) => `<w:p><w:r><w:drawing><wp:inline>${docPr}<a:graphic><a:graphicData uri="${uri}"/></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const r = await run(DOCX, await docx(
    p('Figures', { style: 'Heading1' })
    + drawing('http://schemas.openxmlformats.org/drawingml/2006/picture', '<wp:docPr id="1" name="Line"><a:extLst><a:ext><adec:decorative val="1"/></a:ext></a:extLst></wp:docPr>')
    + drawing('http://schemas.openxmlformats.org/drawingml/2006/chart', '<wp:docPr id="2" name="Chart 2"/>'),
  ));
  assert.deepEqual(criteria(r), ['1.1.1']);
  assert.match(r.issues[0].location.snippet, /^Chart "Chart 2"/);
});

test('Word: a ZIP without a document body is unprocessable', async () => {
  const { strToU8, zipSync } = await import('fflate');
  const buf = Buffer.from(zipSync({ 'word/document.xml': strToU8('<nothing/>') }));
  await assert.rejects(run(DOCX, buf), UnprocessableFileError);
});

// ---------- Groq remediation (optional enhancer) ----------

const sample = [
  { wcag_criterion: '1.1.1', location: { snippet: '<img src="chart.png">' }, severity: 'critical', description: 'Image has no alt.', suggested_fix: 'Add alt text.' },
  { wcag_criterion: '3.1.1', location: null, severity: 'serious', description: 'No language.', suggested_fix: 'Add lang.' },
];
const quiet = { log() {} };

async function withKey(fn) {
  process.env.GROQ_API_KEY = 'test-key';
  try { return await fn(); } finally { delete process.env.GROQ_API_KEY; }
}

test('Groq is not called when no API key is configured', async () => {
  let called = false;
  const out = await improveFixes(sample, { fetchImpl: async () => { called = true; }, log: quiet });
  assert.equal(called, false);
  assert.equal(out, sample);
});

test('Groq rewrites fixes but cannot change the criterion, and bad answers are ignored', () => withKey(async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fixes: [
      { id: 0, fix: 'Add alt="Bar chart of weekly attendance" describing the trend the chart shows.' },
      { id: 1, fix: 'short' },
    ] }) } }] }), { status: 200 });
  };
  const out = await improveFixes(sample, { fetchImpl, log: quiet });
  assert.match(out[0].suggested_fix, /Bar chart/);
  assert.equal(out[0].wcag_criterion, '1.1.1');
  assert.equal(out[1].suggested_fix, 'Add lang.', 'a too-short answer keeps the rule-based fix');
  assert.equal(sent.temperature, 0);
  assert.ok(!JSON.stringify(sent).includes('PK'), 'only issue summaries are sent, never the file');
}));

test('Groq outages and rate limits keep the complete rule-based fixes', () => withKey(async () => {
  for (const fetchImpl of [async () => new Response('busy', { status: 429 }), async () => { throw new Error('network down'); }]) {
    const out = await improveFixes(sample, { fetchImpl, log: quiet });
    assert.deepEqual(out, sample);
  }
}));

test('a repeated problem is capped at 50 issues per criterion and the message says how many more', async () => {
  const r = await run(HTML, page('<h1>T</h1>' + '<img src="x.png">'.repeat(60)));
  assert.equal(r.issues.length, 50);
  assert.match(r.message, /10 more under 1\.1\.1/);
  assert.equal(r.no_violations_detected, false);
});
