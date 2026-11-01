// Test files, each built with one known property so the correct response is never in doubt.
// Generated in code so the repo carries no binary test files.

import { strToU8, zipSync } from 'fflate';

const MB = 1024 * 1024;

const html = (body, lang = ' lang="en"', title = '<title>Syllabus</title>', style = '') =>
  `<!doctype html>\n<html${lang}>\n<head>${title}${style}</head>\n<body>\n${body}\n</body>\n</html>\n`;

function padHtmlTo(bytes) {
  const head = '<!doctype html>\n<html lang="en"><body><h1>Big file</h1><!--';
  const tail = '--></body></html>\n';
  return Buffer.from(head + 'x'.repeat(bytes - head.length - tail.length) + tail);
}

const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';

// ---------- PDF builder: numbered objects -> a PDF with a correct cross-reference table ----------

function buildPdf(objects, { info } = {}) {
  const parts = ['%PDF-1.7\n%âãÏÓ\n'];
  const offsets = [];
  let length = Buffer.byteLength(parts[0], 'latin1');
  const all = info ? [...objects, info] : objects;
  all.forEach((body, i) => {
    offsets.push(length);
    const text = `${i + 1} 0 obj\n${body}\nendobj\n`;
    parts.push(text);
    length += Buffer.byteLength(text, 'latin1');
  });
  const xref = ['xref', `0 ${all.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  const trailer = `trailer\n<< /Size ${all.length + 1} /Root 1 0 R${info ? ` /Info ${all.length} 0 R` : ''} >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.from(parts.join('') + xref + '\n' + trailer, 'latin1');
}

const stream = (dict, data) => `<< ${dict} /Length ${Buffer.byteLength(data, 'latin1')} >>\nstream\n${data}\nendstream`;
const IMAGE = stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', '\u0080');
const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

// A one-page PDF with a heading, a paragraph and an image. Options switch single accessibility features off.
function coursePdf({ tagged = true, figureAlt = 'Bar chart of weekly attendance', lang = 'en-US', title = 'ECE 101 Week 1 Handout', text = true } = {}) {
  const content = (text ? 'BT /F1 18 Tf 72 720 Td (Week 1) Tj ET BT /F1 12 Tf 72 690 Td (Read chapter 1.) Tj ET ' : '') + 'q 200 0 0 100 72 500 cm /Im1 Do Q';
  const resources = text ? '<< /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>' : '<< /XObject << /Im1 6 0 R >> >>';
  const catalog = ['/Type /Catalog /Pages 2 0 R'];
  if (tagged) catalog.push('/MarkInfo << /Marked true >> /StructTreeRoot 7 0 R');
  if (lang) catalog.push(`/Lang (${lang})`);
  if (title) catalog.push('/ViewerPreferences << /DisplayDocTitle true >>');
  const objects = [
    `<< ${catalog.join(' ')} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents 4 0 R${tagged ? ' /StructParents 0' : ''} >>`,
    stream('', content),
    FONT,
    IMAGE,
    '<< /Type /StructTreeRoot /K 8 0 R >>',
    '<< /Type /StructElem /S /Document /P 7 0 R /K [9 0 R 10 0 R 11 0 R] >>',
    '<< /Type /StructElem /S /H1 /P 8 0 R /Pg 3 0 R /K 0 >>',
    '<< /Type /StructElem /S /P /P 8 0 R /Pg 3 0 R /K 1 >>',
    `<< /Type /StructElem /S /Figure /P 8 0 R /Pg 3 0 R /K 2${figureAlt ? ` /Alt (${figureAlt})` : ''} >>`,
  ];
  return buildPdf(objects, { info: title ? `<< /Title (${title}) >>` : undefined });
}

// ---------- DOCX builder: the minimum parts Word needs, plus the ones the checks read ----------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DRAWING_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const imageRun = (descr) => `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"${descr ? ` descr="${descr}"` : ''}/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

function courseDocx({ imageAlt = 'Bar chart of weekly attendance', title = 'ECE 101 Syllabus', lang = 'en-US', headerRow = true } = {}) {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} ${DRAWING_NS}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>ECE 101 Syllabus</w:t></w:r></w:p>
<w:p><w:r><w:t>Office hours are on Mondays.</w:t></w:r></w:p>
<w:p>${imageRun(imageAlt)}</w:p>
<w:tbl><w:tr>${headerRow ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc><w:p><w:r><w:t>Week</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Topic</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Introduction</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/>${lang ? `<w:lang w:val="${lang}"/>` : ''}</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${title ? `<dc:title>${title}</dc:title>` : ''}</cp:coreProperties>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(core),
  };
  // Fixed timestamps keep the bytes identical on every run.
  return Buffer.from(zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') }));
}

// Starts like a Word file and names word/document.xml, so it passes intake, but the archive is broken.
const corruptDocx = Buffer.concat([courseDocx().subarray(0, 120), Buffer.from('word/document.xml'), Buffer.alloc(200, 0x41)]);

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const fixtures = {
  accessibleHtml: { name: 'syllabus.html', type: 'text/html', data: Buffer.from(html('<h1>ECE 101</h1>\n<img src="map.png" alt="Campus map">')) },
  missingAltHtml: { name: 'lecture.html', type: 'text/html', data: Buffer.from(html('<h1>Week 1</h1>\n<img src="chart.png">')) },
  validPdf: { name: 'handout.pdf', type: 'application/pdf', data: Buffer.from(PDF) },
  truncatedPdf: { name: 'broken.pdf', type: 'application/pdf', data: Buffer.from(PDF.slice(0, 40)) },
  emptyFile: { name: 'empty.html', type: 'text/html', data: Buffer.alloc(0) },
  executable: { name: 'notes.exe', type: 'application/x-msdownload', data: Buffer.from('MZ\x90\x00 not a document') },
  exactlyMaxSize: { name: 'max.html', type: 'text/html', data: padHtmlTo(10 * MB) },
  overMaxSize: { name: 'too-big.html', type: 'text/html', data: padHtmlTo(10 * MB + 1) },

  // Phase 4 (REQ-04 to REQ-08)
  lowContrastHtml: { name: 'contrast.html', type: 'text/html', data: Buffer.from(html('<h1>Exam rules</h1>\n<p style="color:#999999">Bring your student ID.</p>')) },
  headingSkipHtml: { name: 'outline.html', type: 'text/html', data: Buffer.from(html('<h1>Course</h1>\n<h3>Grading</h3>\n<p>Exams are 50%.</p>')) },
  noLangNoTitleHtml: { name: 'untitled.html', type: 'text/html', data: Buffer.from(html('<h1>Notes</h1>\n<p>See you Monday.</p>', '', '')) },
  manyProblemsHtml: {
    name: 'many.html', type: 'text/html', data: Buffer.from(html([
      '<h1>Assignment 2</h1>',
      '<img src="diagram.png">',
      '<h4>Submission</h4>',
      '<p style="color:#aaaaaa">Due Friday.</p>',
      '<a href="/a2.pdf">click here</a>',
      '<form><input type="text" id="sid"><button type="submit">Send</button></form>',
    ].join('\n'))),
  },
  richAccessibleHtml: {
    name: 'rich.html', type: 'text/html', data: Buffer.from(html([
      '<header><h1>ECE 101 Syllabus</h1></header>',
      '<main>',
      '<h2>Schedule</h2>',
      '<table><tr><th scope="col">Week</th><th scope="col">Topic</th></tr><tr><td>1</td><td>Introduction</td></tr></table>',
      '<h2>Contact</h2>',
      '<p style="color:#595959">Email the course staff with questions.</p>',
      '<form><label for="email">Your email</label><input type="email" id="email"><button type="submit">Subscribe</button></form>',
      '<p><a href="/slides/week1.pdf">Week 1 slides (PDF)</a></p>',
      '<img src="divider.png" alt="">',
      '<figure><img src="map.png" alt="Map of campus showing the lecture hall"><figcaption>Campus map</figcaption></figure>',
      '</main>',
    ].join('\n'), ' lang="en"', '<title>ECE 101 Syllabus</title>', '<style>main p { color: #333; }</style>')),
  },
  accessiblePdf: { name: 'handout-tagged.pdf', type: 'application/pdf', data: coursePdf() },
  untaggedPdf: { name: 'handout-untagged.pdf', type: 'application/pdf', data: coursePdf({ tagged: false }) },
  figureNoAltPdf: { name: 'handout-noalt.pdf', type: 'application/pdf', data: coursePdf({ figureAlt: null }) },
  accessibleDocx: { name: 'syllabus.docx', type: DOCX_TYPE, data: courseDocx() },
  missingAltDocx: { name: 'syllabus-noalt.docx', type: DOCX_TYPE, data: courseDocx({ imageAlt: null }) },
  corruptDocx: { name: 'broken.docx', type: DOCX_TYPE, data: corruptDocx },
};

// Exposed for unit tests that need variants.
export const builders = { coursePdf, courseDocx, html };
