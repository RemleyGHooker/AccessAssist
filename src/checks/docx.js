import yauzl from 'yauzl';
import { DOMParser } from '@xmldom/xmldom';
import { UnprocessableFileError } from '../errors.js';
import { issue, withinLimit, validLanguage } from './common.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DECORATIVE = 'http://schemas.microsoft.com/office/drawing/2017/decorative';
const MAX_XML_BYTES = 20 * 1024 * 1024;
const parts = new Set(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']);
const descendants = (node, ns, local) => Array.from(node.getElementsByTagNameNS(ns, local));

// Only read required XML entries. No extraction to disk, no external relationships.
function readParts(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      let bytes = 0, count = 0, settled = false;
      const found = new Map();
      const fail = (e) => { if (!settled) { settled = true; zip.close(); reject(e); } };
      zip.on('error', fail);
      zip.on('entry', (entry) => {
        try {
          withinLimit(++count, 10_000);
          if (!parts.has(entry.fileName)) { zip.readEntry(); return; }
          if (found.has(entry.fileName) || entry.uncompressedSize + bytes > MAX_XML_BYTES) throw new Error('Invalid or oversized XML parts');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) return fail(streamError);
            const chunks = [];
            stream.on('error', fail);
            stream.on('data', (chunk) => {
              bytes += chunk.length;
              if (bytes > MAX_XML_BYTES) { stream.destroy(); fail(new Error('Expanded XML exceeds limit')); return; }
              chunks.push(chunk);
            });
            stream.on('end', () => { if (!settled) { found.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); } });
          });
        } catch (e) { fail(e); }
      });
      zip.on('end', () => { if (!settled) { settled = true; resolve(found); } });
      zip.readEntry();
    });
  });
}

function parseXml(text) {
  if (!text || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Missing XML or forbidden declaration');
  return new DOMParser({ onError: () => { throw new Error('Malformed XML'); } }).parseFromString(text, 'application/xml');
}

export async function checkDocx(buffer) {
  let document, styles;
  try {
    const files = await readParts(buffer);
    const contentTypes = parseXml(files.get('[Content_Types].xml'));
    const mainType = Array.from(contentTypes.getElementsByTagName('Override'))
      .find((el) => el.getAttribute('PartName') === '/word/document.xml')?.getAttribute('ContentType');
    if (mainType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') throw new Error('Not a DOCX package');
    document = parseXml(files.get('word/document.xml'));
    if (document.documentElement.namespaceURI !== W || document.documentElement.localName !== 'document'
      || !descendants(document, W, 'body').length) throw new Error('Missing document body');
    styles = files.has('word/styles.xml') ? parseXml(files.get('word/styles.xml')) : null;
  } catch { throw new UnprocessableFileError('The DOCX package is corrupt, encrypted, or contains unsupported XML.'); }
  const issues = [];
  const paragraphs = descendants(document, W, 'p');
  withinLimit(paragraphs.length);
  const defaultLang = styles && descendants(styles, W, 'docDefaults')
    .flatMap((node) => descendants(node, W, 'lang')).map((el) => el.getAttributeNS(W, 'val')).find(validLanguage);
  const explicitLangs = descendants(document, W, 'lang').map((el) => el.getAttributeNS(W, 'val'));
  if (!defaultLang && !explicitLangs.some(validLanguage)) {
    issues.push(issue('3.1.1', { selector: 'word/styles.xml:docDefaults' }, 'serious', 'The Word document has no declared proofing language in the inspected defaults or content.',
      'Set the document proofing language in Word and save it as the default for the document; review passages in other languages separately.'));
  }
  const drawings = descendants(document, W, 'drawing');
  withinLimit(drawings.length, 1000);
  drawings.forEach((drawing, index) => {
    const properties = descendants(drawing, WP, 'docPr');
    const decorative = descendants(drawing, DECORATIVE, 'decorative').some((el) => ['1', 'true'].includes(el.getAttribute('val')));
    const described = properties.some((el) => (el.getAttribute('descr') || el.getAttribute('title') || '').trim());
    // Only pictures (not charts/shapes with their own semantic representation) are checked here.
    const picture = descendants(drawing, A, 'blip').length > 0;
    if (picture && !decorative && !described) {
      issues.push(issue('1.1.1', { selector: `word/document.xml:drawing[${index + 1}]` }, 'critical', 'A Word picture has no text alternative and is not marked decorative.',
        'Open the picture Alt Text pane in Word and describe its purpose, or mark it decorative when it conveys no information.'));
    }
  });
  const tables = descendants(document, W, 'tbl');
  tables.forEach((table, index) => {
    const rows = Array.from(table.childNodes).filter((n) => n.namespaceURI === W && n.localName === 'tr');
    const headerRows = rows.filter((row) => descendants(row, W, 'tblHeader').some((el) => !['0', 'false', 'off'].includes(el.getAttributeNS(W, 'val'))));
    // Header rows explicitly marked by the author must contain text; layout tables are not assumed to be data tables.
    for (const row of headerRows) {
      if (!descendants(row, W, 't').some((el) => el.textContent.trim())) {
        issues.push(issue('1.3.1', { selector: `word/document.xml:table[${index + 1}]` }, 'moderate', 'An explicitly marked Word table header row has no text.',
          'Enter meaningful column headings in the header row; ensure each header describes the related data.'));
      }
    }
  });
  return {
    issues, checks_run: ['1.1.1', '1.3.1', '3.1.1'],
    scope: 'DOCX checks cover picture text alternatives/decorative flags, empty explicitly marked table headers, and language declarations. Headers/footers, legacy VML pictures, visual contrast, reading order, and the quality of alternate text require manual review.',
  };
}
