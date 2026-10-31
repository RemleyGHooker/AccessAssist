// Valid, synthetic documents with known defects; never derive expected answers from the analyzer.
import { PDFDocument, PDFName, PDFString, PDFOperator } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

const MB = 1024 * 1024;
export const html = (body, lang = ' lang="en"', head = '') => `<!doctype html>\n<html${lang}>\n<head><title>Syllabus</title>${head}</head>\n<body>\n${body}\n</body>\n</html>\n`;
const htmlFile = (name, body) => ({ name, type: 'text/html', data: Buffer.from(body) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

function padHtmlTo(bytes) {
  const head = '<!doctype html>\n<html lang="en"><head><title>Big file</title></head><body><h1>Big file</h1><!--';
  const tail = '--></body></html>\n';
  return Buffer.from(head + 'x'.repeat(bytes - head.length - tail.length) + tail);
}

export async function makePdf({ alt = 'One-pixel sample image', tagged = true, language = 'en', title = 'Sample handout' } = {}) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  if (language) doc.catalog.set(PDFName.of('Lang'), PDFString.of(language));
  if (title) doc.setTitle(title);
  const page = doc.addPage([300, 300]);
  const image = await doc.embedPng(png);
  if (tagged) page.pushOperators(PDFOperator.of('BDC', [PDFName.of('Figure'), doc.context.obj({ MCID: 0 })]));
  page.drawImage(image, { x: 40, y: 150, width: 40, height: 40 });
  if (tagged) {
    page.pushOperators(PDFOperator.of('EMC'));
    const root = doc.context.obj({ Type: 'StructTreeRoot' });
    const rootRef = doc.context.register(root);
    const figure = doc.context.obj({ Type: 'StructElem', S: 'Figure', P: rootRef, Pg: page.ref, K: 0 });
    if (alt !== null) figure.set(PDFName.of('Alt'), PDFString.of(alt));
    const figureRef = doc.context.register(figure);
    root.set(PDFName.of('K'), doc.context.obj([figureRef]));
    root.set(PDFName.of('ParentTree'), doc.context.obj({ Nums: [0, [figureRef]] }));
    root.set(PDFName.of('ParentTreeNextKey'), doc.context.obj(1));
    page.node.set(PDFName.of('StructParents'), doc.context.obj(0));
    doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

export function makeDocx({ alt = 'One-pixel sample image', language = 'en', decorative = false, emptyHeader = false, malformed = false } = {}) {
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative"><w:body>
<w:p><w:r><w:t>Sample handout</w:t></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="381000"/><wp:docPr id="1" name="Picture 1"${alt === null ? '' : ` descr="${alt}"`}>${decorative ? '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative val="1"/></a:ext></a:extLst>' : ''}</wp:docPr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
${emptyHeader ? '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Data</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' : ''}
<w:sectPr/></w:body></w:document>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(malformed ? document.slice(0, -30) : document),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${language ? `<w:lang w:val="${language}"/>` : ''}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/media/image1.png': png,
  };
  return Buffer.from(zipSync(files));
}

const validPdf = await makePdf();
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const fixtures = {
  accessibleHtml: htmlFile('syllabus.html', html('<h1>ECE 101</h1>\n<img src="map.png" alt="Campus map">')),
  missingAltHtml: htmlFile('lecture.html', html('<h1>Week 1</h1>\n<img src="chart.png">')),
  contrastHtml: htmlFile('contrast.html', html('<p class="faint">Course announcement</p>', undefined, '<style>.faint {color:#aaa;background-color:#fff;font-size:16px}</style>')),
  missingLanguageHtml: htmlFile('language.html', html('<p>Course</p>', '')),
  formHtml: htmlFile('form.html', html('<input id="name" type="text"><button></button>')),
  functionalImageHtml: htmlFile('functional.html', html('<a href="#"><img src="go.png" alt=""></a>')),
  validPdf: { name: 'handout.pdf', type: 'application/pdf', data: validPdf },
  missingAltPdf: { name: 'figure.pdf', type: 'application/pdf', data: await makePdf({ alt: null }) },
  untaggedPdf: { name: 'untagged.pdf', type: 'application/pdf', data: await makePdf({ tagged: false, language: '', title: '' }) },
  truncatedPdf: { name: 'broken.pdf', type: 'application/pdf', data: validPdf.subarray(0, 40) },
  fakePdf: { name: 'fake.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nnot a real document\n%%EOF') },
  validDocx: { name: 'handout.docx', type: DOCX, data: makeDocx() },
  missingAltDocx: { name: 'picture.docx', type: DOCX, data: makeDocx({ alt: null }) },
  malformedDocx: { name: 'broken.docx', type: DOCX, data: makeDocx({ malformed: true }) },
  emptyFile: htmlFile('empty.html', ''),
  executable: { name: 'notes.exe', type: 'application/x-msdownload', data: Buffer.from('MZ\x90\x00 not a document') },
  exactlyMaxSize: { name: 'max.html', type: 'text/html', data: padHtmlTo(10 * MB) },
  overMaxSize: { name: 'too-big.html', type: 'text/html', data: padHtmlTo(10 * MB + 1) },
};
