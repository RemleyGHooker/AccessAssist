// Rule-based WCAG 2.1 checks for PDF documents (REQ-04 to REQ-07), following the W3C PDF
// techniques (PDF1 alt text, PDF6/PDF9 tagged structure, PDF16 language, PDF18 title).
// pdf-lib reads the document structure; no page content is rendered or sent anywhere.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString } from 'pdf-lib';

export class UnreadablePdfError extends Error {}

const MAX_STRUCT_NODES = 50_000; // guards against huge or cyclic structure trees

const str = (obj) => (obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : undefined);
const name = (obj) => (obj instanceof PDFName ? obj.decodeText() : undefined);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

export async function loadPdf(buffer) {
  let doc;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    throw new UnreadablePdfError(e.message);
  }
  if (!(doc.context.trailerInfo.Root instanceof PDFRef) || !(doc.catalog instanceof PDFDict)) {
    throw new UnreadablePdfError('The PDF has no document catalog.');
  }
  let pages;
  try { pages = doc.getPages(); } catch (e) { throw new UnreadablePdfError(e.message); }
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i + 1]));
  return { doc, pages, pageIndex, catalog: doc.catalog };
}

function issue(location, severity, description, suggested_fix) {
  return { location, severity, description, suggested_fix };
}

// ---------- structure tree helpers ----------

function isTagged(ctx) {
  const mark = ctx.catalog.lookup(PDFName.of('MarkInfo'));
  const marked = mark instanceof PDFDict ? mark.lookup(PDFName.of('Marked')) : undefined;
  const root = ctx.catalog.lookup(PDFName.of('StructTreeRoot'));
  return root instanceof PDFDict && String(marked) === 'true';
}

// Walk every structure element once, resolving custom tag names through the RoleMap.
function structElements(ctx) {
  if (ctx.structCache) return ctx.structCache;
  const root = ctx.catalog.lookup(PDFName.of('StructTreeRoot'));
  const out = [];
  if (!(root instanceof PDFDict)) return (ctx.structCache = out);
  const roleMapDict = root.lookup(PDFName.of('RoleMap'));
  const roleOf = (type) => {
    let t = type;
    for (let i = 0; i < 5 && roleMapDict instanceof PDFDict; i++) {
      const mapped = name(roleMapDict.lookup(PDFName.of(t)));
      if (!mapped || mapped === t) break;
      t = mapped;
    }
    return t;
  };
  const seen = new Set();
  const visit = (obj, parent, inheritedPage) => {
    if (out.length >= MAX_STRUCT_NODES) return;
    if (obj instanceof PDFRef) {
      if (seen.has(obj.toString())) return;
      seen.add(obj.toString());
      visit(ctx.doc.context.lookup(obj), parent, inheritedPage);
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) visit(obj.get(i), parent, inheritedPage);
      return;
    }
    if (!(obj instanceof PDFDict)) return;
    const type = name(obj.lookup(PDFName.of('S')));
    const pg = obj.get(PDFName.of('Pg'));
    const page = pg instanceof PDFRef ? ctx.pageIndex.get(pg.toString()) ?? inheritedPage : inheritedPage;
    if (!type) return; // marked-content or object reference, not a structure element
    const el = { dict: obj, type, role: roleOf(type), page, parent, children: [] };
    parent?.children.push(el);
    out.push(el);
    visit(obj.get(PDFName.of('K')), el, page);
  };
  visit(root.get(PDFName.of('K')), null, undefined);
  return (ctx.structCache = out);
}

const pageLocation = (page, snippet) => {
  const loc = {};
  if (page) loc.page = page;
  if (snippet) loc.snippet = snippet;
  return Object.keys(loc).length ? loc : null;
};

// ---------- page content helpers ----------

function inherited(pageNode, key) {
  for (let node = pageNode, i = 0; node instanceof PDFDict && i < 32; i++) {
    const v = node.lookup(PDFName.of(key));
    if (v !== undefined) return v;
    node = node.lookup(PDFName.of('Parent'));
  }
  return undefined;
}

// Does this resource dictionary (or a form XObject inside it) provide fonts / images?
function scanResources(ctx, resources, depth = 0, seen = new Set()) {
  const found = { fonts: false, images: false };
  if (!(resources instanceof PDFDict) || depth > 4) return found;
  const fonts = resources.lookup(PDFName.of('Font'));
  if (fonts instanceof PDFDict && fonts.keys().length > 0) found.fonts = true;
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (xobjects instanceof PDFDict) {
    for (const key of xobjects.keys()) {
      const ref = xobjects.get(key);
      if (ref instanceof PDFRef) {
        if (seen.has(ref.toString())) continue;
        seen.add(ref.toString());
      }
      const x = ctx.doc.context.lookup(ref);
      const dict = x instanceof PDFStream ? x.dict : x;
      if (!(dict instanceof PDFDict)) continue;
      const subtype = name(dict.lookup(PDFName.of('Subtype')));
      if (subtype === 'Image') found.images = true;
      if (subtype === 'Form') {
        const inner = scanResources(ctx, dict.lookup(PDFName.of('Resources')), depth + 1, seen);
        found.fonts ||= inner.fonts;
        found.images ||= inner.images;
      }
    }
  }
  return found;
}

function pageContent(ctx) {
  if (!ctx.contentCache) {
    ctx.contentCache = ctx.pages.map((p, i) => ({ page: i + 1, ...scanResources(ctx, inherited(p.node, 'Resources')) }));
  }
  return ctx.contentCache;
}

const listPages = (pages) => (pages.length > 10 ? `${pages.slice(0, 10).join(', ')} and ${pages.length - 10} more` : pages.join(', '));

// ---------- 1.1.1 Non-text Content ----------

function checkFigures(ctx) {
  if (!isTagged(ctx)) {
    // An untagged PDF has nowhere to store alt text, so any image in it lacks a text alternative.
    const withImages = pageContent(ctx).filter((p) => p.images && p.fonts).map((p) => p.page);
    if (withImages.length === 0) return [];
    return [issue(pageLocation(withImages[0]), 'critical',
      `The PDF is not tagged, so the images on page(s) ${listPages(withImages)} have no alternate text for screen reader users.`,
      'Tag the PDF (for example, export from Word with "Document structure tags for accessibility" on, or use Acrobat\'s Autotag), then add alternate text to each Figure tag.')];
  }
  const out = [];
  for (const el of structElements(ctx)) {
    if (el.role !== 'Figure') continue;
    const alt = str(el.dict.lookup(PDFName.of('Alt'))) ?? str(el.dict.lookup(PDFName.of('ActualText')));
    if (nonEmpty(alt)) continue;
    out.push(issue(pageLocation(el.page, `<${el.type}> structure element`), 'critical',
      `Figure${el.page ? ` on page ${el.page}` : ''} has no alternate text, so screen reader users get no description of it.`,
      'In Acrobat, open Accessibility > Set Alternate Text (or the figure\'s tag properties) and enter a short description. Mark purely decorative images as artifacts instead.'));
  }
  return out;
}

// ---------- 1.3.1 Info and Relationships ----------

function checkTagging(ctx) {
  if (!isTagged(ctx)) {
    return [issue(null, 'serious',
      'The PDF is not tagged, so screen readers cannot identify its headings, lists, tables or reading order.',
      'Recreate the PDF from the source document with tagging enabled (in Word: File > Save As > PDF > Options > "Document structure tags for accessibility"), or run Autotag in Acrobat and review the tags.')];
  }
  const out = [];
  for (const el of structElements(ctx)) {
    if (el.role !== 'Table') continue;
    const stack = [...el.children];
    let hasHeader = false;
    while (stack.length && !hasHeader) {
      const c = stack.pop();
      if (c.role === 'TH') hasHeader = true;
      else stack.push(...c.children);
    }
    if (hasHeader) continue;
    out.push(issue(pageLocation(el.page, `<${el.type}> structure element`), 'serious',
      `Table${el.page ? ` on page ${el.page}` : ''} has no header cells (TH tags), so screen readers cannot announce which row or column a cell belongs to.`,
      'Mark the header row or column cells with TH tags (in Acrobat: Table Editor > Table Cell Properties > Header cell), or mark the table as an artifact if it is only for layout.'));
  }
  return out;
}

// ---------- 1.4.5 Images of Text ----------

function checkScanned(ctx) {
  const scanned = pageContent(ctx).filter((p) => p.images && !p.fonts).map((p) => p.page);
  if (scanned.length === 0) return [];
  return [issue(pageLocation(scanned[0]), 'serious',
    `Page(s) ${listPages(scanned)} contain images but no real text, which usually means a scanned page. Screen readers cannot read it and the text cannot be resized or searched.`,
    'Run OCR (for example, Acrobat > Scan & OCR > Recognize Text) or recreate the page from the original digital source, then tag it.')];
}

// ---------- 2.4.2 Page Titled ----------

function checkTitle(ctx) {
  let title = ctx.doc.getTitle();
  if (!nonEmpty(title)) {
    const meta = ctx.catalog.lookup(PDFName.of('Metadata'));
    if (meta instanceof PDFStream) {
      try {
        const xml = Buffer.from(meta.getContents()).toString('utf8');
        title = xml.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/)?.[1];
      } catch { /* compressed or unreadable metadata: rely on the Info dictionary */ }
    }
  }
  if (!nonEmpty(title)) {
    return [issue(null, 'serious',
      'The PDF has no document title, so screen readers and browser tabs show only the file name.',
      'Set a descriptive title (in Word: File > Info > Title; in Acrobat: File > Properties > Description > Title) and set Initial View > Show to "Document Title".')];
  }
  const prefs = ctx.catalog.lookup(PDFName.of('ViewerPreferences'));
  const display = prefs instanceof PDFDict ? String(prefs.lookup(PDFName.of('DisplayDocTitle'))) : 'undefined';
  if (display !== 'true') {
    return [issue(pageLocation(null, `Title: ${title.slice(0, 100)}`), 'minor',
      'The PDF has a title, but viewers are not told to display it, so the file name is shown instead.',
      'In Acrobat, open File > Properties > Initial View and set Show to "Document Title" (DisplayDocTitle).')];
  }
  return [];
}

// ---------- 3.1.1 Language of Page ----------

function checkLanguage(ctx) {
  const lang = str(ctx.catalog.lookup(PDFName.of('Lang')));
  if (nonEmpty(lang) && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang.trim())) return [];
  return [issue(null, 'serious',
    nonEmpty(lang) ? `The PDF language "${lang}" is not a valid language code.` : 'The PDF does not declare its language, so screen readers may mispronounce it.',
    'Set the document language (in Acrobat: File > Properties > Advanced > Language; in Word, set the proofing language before exporting).')];
}

// ---------- 4.1.2 Name, Role, Value (form fields) ----------

function checkFormFields(ctx) {
  let fields;
  try { fields = ctx.doc.getForm().getFields(); } catch { return []; }
  const out = [];
  for (const f of fields) {
    const dict = f.acroField.dict;
    if (nonEmpty(str(dict.lookup(PDFName.of('TU'))))) continue;
    const ff = dict.lookup(PDFName.of('Ff'));
    // Push buttons get their name from their caption; skip them.
    if (ff instanceof PDFNumber && (ff.asNumber() & (1 << 16))) continue;
    let page;
    try {
      const p = f.acroField.getWidgets()[0]?.dict.get(PDFName.of('P'));
      if (p instanceof PDFRef) page = ctx.pageIndex.get(p.toString());
    } catch { /* widget without a page reference */ }
    out.push(issue(pageLocation(page, `Form field "${f.getName()}"`), 'critical',
      `Form field "${f.getName()}" has no tooltip (accessible name), so screen reader users are not told what to enter.`,
      'In Acrobat, open the field\'s Properties > General and enter a Tooltip that describes what to enter.'));
  }
  return out;
}

export const pdfRules = [
  { criterion: '1.1.1', run: checkFigures },
  { criterion: '1.3.1', run: checkTagging },
  { criterion: '1.4.5', run: checkScanned },
  { criterion: '2.4.2', run: checkTitle },
  { criterion: '3.1.1', run: checkLanguage },
  { criterion: '4.1.2', run: checkFormFields },
];
