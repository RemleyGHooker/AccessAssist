import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';
import { UnprocessableFileError } from '../errors.js';
import { issue, withinLimit, validLanguage } from './common.js';

const key = (name) => PDFName.of(name);
const text = (value) => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText().trim() : '';

export async function checkPdf(buffer) {
  let doc;
  try {
    doc = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: true });
    if (doc.getPageCount() < 1) throw new Error('No readable pages');
  } catch { throw new UnprocessableFileError('The PDF is corrupt, encrypted, or has no readable pages.'); }
  withinLimit(doc.getPageCount(), 500);
  const issues = [];
  const catalog = doc.catalog;
  if (!validLanguage(text(catalog.lookup(key('Lang'))))) {
    issues.push(issue('3.1.1', null, 'serious', 'The PDF has no valid default document language.',
      'Set the PDF document language in the source document or PDF accessibility properties, then export again.'));
  }
  if (!doc.getTitle()?.trim()) {
    issues.push(issue('2.4.2', null, 'moderate', 'The PDF has no document title metadata.',
      'Set a descriptive document title in PDF properties and configure the viewer to display it.'));
  }
  const tree = catalog.lookup(key('StructTreeRoot'));
  const hasTree = tree instanceof PDFDict && tree.has(key('K'));
  if (!hasTree) {
    issues.push(issue('1.3.1', null, 'serious', 'The PDF has no usable structure tree for programmatic reading order.',
      'Export a tagged PDF from a structured source document, then inspect heading, list, table, and reading-order tags with an accessibility checker.'));
  }
  const seen = new Set();
  const pages = new Map(doc.getPages().map((page, i) => [String(page.ref), i + 1]));
  const roleMap = hasTree ? tree.lookup(key('RoleMap')) : undefined;
  let visited = 0;
  const visit = (ref, inheritedPage) => {
    withinLimit(++visited);
    const node = doc.context.lookup(ref);
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node instanceof PDFArray) { for (let i = 0; i < node.size(); i++) visit(node.get(i), inheritedPage); return; }
    if (!(node instanceof PDFDict)) return;
    const page = pages.get(String(node.get(key('Pg')))) || inheritedPage;
    let role = node.lookup(key('S'));
    if (role instanceof PDFName && roleMap instanceof PDFDict) role = roleMap.lookup(role) || role;
    if (String(role) === '/Figure' && !text(node.lookup(key('Alt'))) && !text(node.lookup(key('ActualText')))) {
      issues.push(issue('1.1.1', page ? { page } : null, 'critical', 'A tagged PDF figure has no text alternative.',
        'Add meaningful alternate text to the Figure tag, or mark a purely decorative image as an artifact; do not invent an image description.'));
      withinLimit(issues.length, 1000);
    }
    if (node.has(key('K'))) visit(node.get(key('K')), page);
  };
  if (hasTree) visit(tree);
  return {
    issues, checks_run: ['1.3.1', '2.4.2', '3.1.1', ...(hasTree ? ['1.1.1'] : [])],
    scope: 'PDF checks inspect title, language, structure-tree presence, and text alternatives on tagged Figure elements. OCR, untagged images, visual contrast, tag correctness, and reading order require manual review; this is not a PDF/UA validation.',
  };
}
