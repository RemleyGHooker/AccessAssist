// Rule-based WCAG 2.1 checks for Word (.docx) documents (REQ-04 to REQ-07).
// A .docx is a ZIP of XML parts. We unzip only the parts we need, in memory, and read
// the WordprocessingML markup Word itself uses for alt text, headings, tables and colors.

import { unzipSync } from 'fflate';
import { contrastRatio, parseHexColor, requiredRatio, toHex } from './contrast.js';

export class UnreadableDocxError extends Error {}

const PARTS = ['word/document.xml', 'word/styles.xml', 'word/settings.xml', 'docProps/core.xml'];
const MAX_PART_BYTES = 50 * 1024 * 1024; // refuse zip bombs: no single XML part over 50 MB unpacked
const VAGUE_LINK_TEXT = /^(click here|here|click|more|read more|learn more|link|this link|this|go|details|more info|info)$/i;
const HIGHLIGHT = { yellow: 'ffff00', green: '00ff00', cyan: '00ffff', magenta: 'ff00ff', blue: '0000ff', red: 'ff0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'c0c0c0', black: '000000', white: 'ffffff' };

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, nameAttr) => {
  const m = tag.match(new RegExp(`\\b${nameAttr}="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
};
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const textOf = (xml) => decode([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).trim();
const truncate = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isOn = (xml, tagName) => {
  const m = xml.match(new RegExp(`<w:${tagName}(\\s[^>]*)?/>`));
  return Boolean(m) && !/w:val="(0|false|off)"/.test(m[1] ?? '');
};

// Find every outermost <prefix:tag ...>...</prefix:tag> element, handling nesting.
function elements(xml, tag) {
  const out = [];
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'g');
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(re)) {
    if (m[2] === '/') { if (depth === 0) out.push(m[0]); continue; }
    if (m[1] === '/') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(xml.slice(start, m.index + m[0].length)); start = -1; }
      if (depth < 0) depth = 0;
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

export function loadDocx(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), {
      filter: (f) => {
        if (!PARTS.includes(f.name)) return false;
        if (f.originalSize > MAX_PART_BYTES) throw new UnreadableDocxError(`${f.name} is too large to unpack.`);
        return true;
      },
    });
  } catch (e) {
    throw e instanceof UnreadableDocxError ? e : new UnreadableDocxError(`Not a readable Word file: ${e.message}`);
  }
  if (!files['word/document.xml']) throw new UnreadableDocxError('The Word file has no word/document.xml.');
  const part = (n) => (files[n] ? Buffer.from(files[n]).toString('utf8') : '');
  const document = part('word/document.xml');
  if (!/<w:body\b/.test(document)) throw new UnreadableDocxError('The Word file has no document body.');
  const styles = part('word/styles.xml');

  // styleId -> { name, level } so heading paragraphs are found whatever the UI language.
  const styleMap = new Map();
  for (const s of elements(styles, 'w:style')) {
    const id = attr(s.match(/<w:style\b[^>]*>/)?.[0] ?? '', 'w:styleId');
    const styleName = attr(s.match(/<w:name\b[^>]*>/)?.[0] ?? '', 'w:val') ?? '';
    const outline = s.match(/<w:outlineLvl w:val="(\d)"/);
    const level = /^heading (\d)$/i.test(styleName) ? Number(styleName.slice(-1)) : outline ? Number(outline[1]) + 1 : null;
    if (id) styleMap.set(id, { name: styleName, level });
  }
  const defaults = elements(styles, 'w:docDefaults')[0] ?? '';
  const defaultSz = Number(defaults.match(/<w:sz w:val="(\d+)"/)?.[1] ?? 22); // half-points; Word's default is 11 pt

  const body = elements(document, 'w:body')[0] ?? document;
  const paragraphs = elements(body, 'w:p').map((xml, i) => {
    const pPr = elements(xml, 'w:pPr')[0] ?? '';
    const styleId = attr(pPr.match(/<w:pStyle\b[^>]*>/)?.[0] ?? '', 'w:val');
    const outline = pPr.match(/<w:outlineLvl w:val="(\d)"/);
    const level = outline ? Number(outline[1]) + 1 : styleMap.get(styleId)?.level ?? null;
    return { xml, index: i + 1, text: textOf(xml), styleId, level: level && level <= 9 ? level : null };
  });

  return {
    document,
    body,
    paragraphs,
    tables: elements(body, 'w:tbl'),
    styles,
    settings: part('word/settings.xml'),
    core: part('docProps/core.xml'),
    defaultSz,
    pageBackground: parseHexColor(attr(document.match(/<w:background\b[^>]*>/)?.[0] ?? '', 'w:color')) ?? [255, 255, 255],
  };
}

function issue(location, severity, description, suggested_fix) {
  return { location, severity, description, suggested_fix };
}

const paraLocation = (p, prefix) => ({ snippet: `${prefix ? `${prefix} ` : ''}(paragraph ${p.index}${p.text ? `: "${truncate(p.text)}"` : ''})` });

// ---------- 1.1.1 Non-text Content ----------

function checkAltText(ctx) {
  const out = [];
  for (const p of ctx.paragraphs) {
    for (const drawing of elements(p.xml, 'w:drawing')) {
      const uri = drawing.match(/<a:graphicData\b[^>]*uri="([^"]*)"/)?.[1] ?? '';
      if (!/\/(picture|chart|diagram)$/.test(uri)) continue; // text boxes and shapes carry their own text
      const docPr = drawing.match(/<wp:docPr\b[^>]*?(?:\/>|>[\s\S]*?<\/wp:docPr>)/)?.[0] ?? '';
      if (/<adec:decorative\b[^>]*w?:?val="1"/.test(docPr) || /decorative[^>]*val="(1|true)"/.test(docPr)) continue;
      const startTag = docPr.match(/<wp:docPr\b[^>]*>/)?.[0] ?? '';
      if (nonEmpty(attr(startTag, 'descr')) || nonEmpty(attr(startTag, 'title'))) continue;
      const kind = uri.endsWith('/chart') ? 'Chart' : uri.endsWith('/diagram') ? 'SmartArt graphic' : 'Image';
      const label = attr(startTag, 'name') ?? kind;
      out.push(issue(paraLocation(p, `${kind} "${label}"`), 'critical',
        `${kind} "${label}" has no alt text, so screen reader users get no description of it.`,
        'Right-click the image in Word, choose "Edit Alt Text", and describe what it shows, or tick "Mark as decorative" if it adds no information.'));
    }
    // Legacy VML images (older Word files).
    for (const shape of elements(p.xml, 'v:shape')) {
      if (!/<v:imagedata\b/.test(shape)) continue;
      const tag = shape.match(/<v:shape\b[^>]*>/)?.[0] ?? '';
      if (nonEmpty(attr(tag, 'alt'))) continue;
      out.push(issue(paraLocation(p, 'Image'), 'critical',
        'Image has no alt text, so screen reader users get no description of it.',
        'Right-click the image in Word, choose "Edit Alt Text", and describe what it shows.'));
    }
  }
  return out;
}

// ---------- 1.3.1 Info and Relationships ----------

function looksLikeHeading(p, defaultSz) {
  if (p.level || !p.text || p.text.length > 80 || /[.,;:]$/.test(p.text)) return false;
  const runs = elements(p.xml, 'w:r').filter((r) => textOf(r));
  if (runs.length === 0) return false;
  const bold = runs.every((r) => isOn(elements(r, 'w:rPr')[0] ?? '', 'b'));
  const big = runs.every((r) => Number((elements(r, 'w:rPr')[0] ?? '').match(/<w:sz w:val="(\d+)"/)?.[1] ?? defaultSz) >= 28);
  return bold || big;
}

function checkStructure(ctx) {
  const out = [];
  const headings = ctx.paragraphs.filter((p) => p.level && p.text);
  let previous = null;
  for (const p of headings) {
    if (previous !== null && p.level > previous + 1) {
      out.push(issue(paraLocation(p, `Heading ${p.level}`), 'moderate',
        `Heading level jumps from ${previous} to ${p.level}, so the outline screen reader users navigate by has a gap.`,
        `Apply the "Heading ${previous + 1}" style here instead, so heading levels go down one step at a time.`));
    }
    previous = p.level;
  }
  if (headings.length === 0) {
    const fake = ctx.paragraphs.filter((p) => looksLikeHeading(p, ctx.defaultSz));
    if (fake.length > 0) {
      out.push(issue(paraLocation(fake[0], 'Formatted heading'), 'moderate',
        `The document uses bold or large text as headings (${fake.length} paragraph(s)) but no Heading styles, so screen reader users cannot navigate by heading.`,
        'Apply Word\'s built-in "Heading 1", "Heading 2"... styles from the Home tab to section titles instead of formatting them by hand.'));
    }
  }
  ctx.tables.forEach((t, i) => {
    const rows = elements(t, 'w:tr');
    if (rows.length < 2) return;
    const trPr = elements(rows[0], 'w:trPr')[0] ?? '';
    if (isOn(trPr, 'tblHeader')) return;
    const firstCell = textOf(elements(rows[0], 'w:tc')[0] ?? '');
    out.push(issue({ snippet: `Table ${i + 1}${firstCell ? ` (starts with "${truncate(firstCell, 40)}")` : ''}` }, 'serious',
      `Table ${i + 1} has no header row marked, so screen readers cannot announce which column a cell belongs to.`,
      'Select the first row, open Table Properties > Row, and tick "Repeat as header row at the top of each page".'));
  });
  return out;
}

// ---------- 1.4.3 Contrast (Minimum) ----------

function checkContrast(ctx) {
  const out = [];
  for (const p of ctx.paragraphs) {
    const pPr = elements(p.xml, 'w:pPr')[0] ?? '';
    const pShade = parseHexColor(attr(pPr.match(/<w:shd\b[^>]*>/)?.[0] ?? '', 'w:fill'));
    const reported = new Set();
    for (const r of elements(p.xml, 'w:r')) {
      const text = textOf(r);
      if (!text) continue;
      const rPr = elements(r, 'w:rPr')[0] ?? '';
      const fg = parseHexColor(attr(rPr.match(/<w:color\b[^>]*>/)?.[0] ?? '', 'w:val'));
      if (!fg) continue; // "auto" text color always contrasts with its background
      const highlight = HIGHLIGHT[attr(rPr.match(/<w:highlight\b[^>]*>/)?.[0] ?? '', 'w:val')];
      const bg = (highlight && parseHexColor(highlight))
        ?? parseHexColor(attr(rPr.match(/<w:shd\b[^>]*>/)?.[0] ?? '', 'w:fill'))
        ?? pShade ?? ctx.pageBackground;
      const halfPoints = Number(rPr.match(/<w:sz w:val="(\d+)"/)?.[1] ?? ctx.defaultSz);
      const px = (halfPoints / 2) * (4 / 3);
      const ratio = contrastRatio(fg, bg);
      const needed = requiredRatio(px, isOn(rPr, 'b'));
      const key = `${toHex(fg)}/${toHex(bg)}`;
      if (ratio + 1e-9 >= needed || reported.has(key)) continue;
      reported.add(key);
      out.push(issue({ snippet: `"${truncate(text)}" (paragraph ${p.index})` }, 'serious',
        `Text color ${toHex(fg)} on background ${toHex(bg)} has a contrast ratio of ${Math.floor(ratio * 100) / 100}:1, below the ${needed}:1 minimum, so it is hard to read for people with low vision.`,
        `Change the font color (Home > Font Color) to a darker shade, or "Automatic", so the contrast ratio is at least ${needed}:1.`));
    }
  }
  return out;
}

// ---------- 2.4.2 Page Titled ----------

function checkTitle(ctx) {
  const title = ctx.core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1];
  if (nonEmpty(title && decode(title))) return [];
  return [issue(null, 'serious',
    'The Word document has no title, so screen readers, browser tabs and exported PDFs show only the file name.',
    'In Word, open File > Info and fill in the Title property with a descriptive title.')];
}

// ---------- 2.4.4 Link Purpose ----------

function checkLinks(ctx) {
  const out = [];
  for (const p of ctx.paragraphs) {
    for (const link of elements(p.xml, 'w:hyperlink')) {
      const text = textOf(link);
      if (!text) {
        if (/<w:drawing\b/.test(link)) continue; // linked image: its alt text is checked under 1.1.1
        out.push(issue(paraLocation(p, 'Link'), 'serious',
          'Link has no text, so screen reader users hear only "link" with no destination.',
          'Select the link and type descriptive text for it (Insert > Link > Text to display).'));
      } else if (VAGUE_LINK_TEXT.test(text.replace(/[.!:]+$/, ''))) {
        out.push(issue(paraLocation(p, `Link "${text}"`), 'moderate',
          `Link text "${text}" does not say where the link goes when read on its own.`,
          'Edit the link (Insert > Link) and change "Text to display" to name the destination, for example "Week 1 slides".'));
      }
    }
  }
  return out;
}

// ---------- 3.1.1 Language of Page ----------

function checkLanguage(ctx) {
  const defaults = elements(ctx.styles, 'w:docDefaults')[0] ?? '';
  const lang = attr(defaults.match(/<w:lang\b[^>]*>/)?.[0] ?? '', 'w:val')
    ?? attr(ctx.settings.match(/<w:themeFontLang\b[^>]*>/)?.[0] ?? '', 'w:val');
  if (nonEmpty(lang)) return [];
  return [issue(null, 'serious',
    'The Word document does not declare its language, so screen readers may mispronounce it.',
    'Select all text, open Review > Language > Set Proofing Language, choose the document\'s language, and click "Default".')];
}

export const docxRules = [
  { criterion: '1.1.1', run: checkAltText },
  { criterion: '1.3.1', run: checkStructure },
  { criterion: '1.4.3', run: checkContrast },
  { criterion: '2.4.2', run: checkTitle },
  { criterion: '2.4.4', run: checkLinks },
  { criterion: '3.1.1', run: checkLanguage },
];
