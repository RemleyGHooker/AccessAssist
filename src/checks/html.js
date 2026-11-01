// Rule-based WCAG 2.1 checks for HTML documents (REQ-04 to REQ-07).
// The page is parsed into a DOM (cheerio/parse5) with source positions, so every issue
// can point at its line, a CSS selector, and a snippet of the offending markup.

import { load } from 'cheerio';
import { contrastRatio, parseColor, requiredRatio, toHex } from './contrast.js';

const SNIPPET_MAX = 120;
const SKIP_TEXT_IN = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'svg', 'math', 'iframe', 'textarea', 'select', 'option']);
const VAGUE_LINK_TEXT = /^(click here|here|click|more|read more|learn more|link|this link|this|go|details|more info|info)$/i;
const IMAGE_FILE_NAME = /^\S+\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;
const GENERIC_ALT = /^(image|picture|photo|graphic|img|icon|logo|figure|chart|spacer|untitled)$/i;
const LANG_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

// ---------- helpers ----------

// Locations are computed lazily (see runRules), only for issues that make it into the response.
function locate(ctx, el) {
  return () => computeLocation(ctx, el);
}

function computeLocation(ctx, el) {
  const loc = el.sourceCodeLocation;
  const location = { selector: selectorFor(el) };
  if (loc) {
    location.line = loc.startLine;
    const end = loc.startTag?.endOffset ?? loc.endOffset;
    location.snippet = ctx.text.slice(loc.startOffset, Math.min(end, loc.startOffset + SNIPPET_MAX));
  }
  return location;
}

// nth-of-type positions, computed once per parent so large pages stay linear.
const typeIndex = new WeakMap();
function nthOfType(node) {
  const parent = node.parent;
  if (!parent) return { index: 1, count: 1 };
  let info = typeIndex.get(parent);
  if (!info) {
    info = { index: new Map(), count: new Map() };
    for (const n of parent.children ?? []) {
      if (n.type !== 'tag') continue;
      const c = (info.count.get(n.name) ?? 0) + 1;
      info.count.set(n.name, c);
      info.index.set(n, c);
    }
    typeIndex.set(parent, info);
  }
  return { index: info.index.get(node) ?? 1, count: info.count.get(node.name) ?? 1 };
}

function selectorFor(el) {
  const parts = [];
  for (let node = el; node && node.type === 'tag'; node = node.parent) {
    const id = node.attribs?.id;
    if (id && /^[A-Za-z][\w-]*$/.test(id)) { parts.unshift(`${node.name}#${id}`); break; }
    if (node.name === 'html' || node.name === 'body') { parts.unshift(node.name); break; }
    const { index, count } = nthOfType(node);
    parts.unshift(count > 1 ? `${node.name}:nth-of-type(${index})` : node.name);
  }
  return parts.join(' > ');
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function labelledByText($, el) {
  const ids = (el.attribs['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => $(`[id="${id.replace(/"/g, '')}"]`).text()).join(' ').trim();
}

// Accessible name, simplified from the W3C accname algorithm: aria-labelledby, aria-label,
// then visible text (including alt text of images inside), then title.
function accessibleName($, el) {
  const byRef = labelledByText($, el);
  if (byRef) return byRef;
  if (nonEmpty(el.attribs['aria-label'])) return el.attribs['aria-label'].trim();
  const $el = $(el);
  const text = ($el.text() + ' ' + $el.find('img[alt], [aria-label]').map((_, n) => n.attribs.alt ?? n.attribs['aria-label']).get().join(' '))
    .replace(/\s+/g, ' ').trim();
  if (text) return text;
  return (el.attribs.title ?? '').trim();
}

// Ancestor test by walking parents directly; cheerio's closest() re-runs a CSS engine per call,
// which is too slow on pages with hundreds of thousands of elements.
function hasAncestor(el, test) {
  for (let n = el; n && n.type === 'tag'; n = n.parent) if (test(n)) return true;
  return false;
}

function isDecorative(el) {
  return /^(presentation|none)$/i.test(el.attribs.role ?? '');
}

function issue(location, severity, description, suggested_fix) {
  return { location, severity, description, suggested_fix };
}

// ---------- 1.1.1 Non-text Content ----------

function checkTextAlternatives(ctx) {
  const { $ } = ctx;
  const out = [];
  $('img').each((_, el) => {
    if (isDecorative(el)) return;
    const alt = el.attribs.alt;
    if (alt === undefined) {
      if (nonEmpty(el.attribs['aria-label']) || labelledByText($, el) || nonEmpty(el.attribs.title)) return;
      out.push(issue(locate(ctx, el), 'critical',
        'Image has no alt attribute, so screen reader users get no description of it.',
        'Add a descriptive alt attribute, or alt="" if the image is purely decorative.'));
      return;
    }
    const a = alt.trim();
    if (a && (IMAGE_FILE_NAME.test(a) || GENERIC_ALT.test(a))) {
      out.push(issue(locate(ctx, el), 'moderate',
        `Image alt text "${a}" is a file name or generic word, so it does not describe the image.`,
        'Replace the alt text with a short description of what the image shows or does, or use alt="" if it is decorative.'));
    }
  });
  $('input[type="image" i]').each((_, el) => {
    if (nonEmpty(el.attribs.alt) || nonEmpty(el.attribs['aria-label']) || labelledByText($, el) || nonEmpty(el.attribs.title)) return;
    out.push(issue(locate(ctx, el), 'critical',
      'Image button has no alt text, so screen reader users cannot tell what it does.',
      'Add an alt attribute that names the action, for example alt="Search".'));
  });
  $('area[href]').each((_, el) => {
    if (nonEmpty(el.attribs.alt) || nonEmpty(el.attribs['aria-label'])) return;
    out.push(issue(locate(ctx, el), 'critical',
      'Image map area has no alt text, so screen reader users cannot tell where the link goes.',
      'Add an alt attribute to the area that describes the link destination.'));
  });
  $('svg[role="img" i]').each((_, el) => {
    if (nonEmpty(el.attribs['aria-label']) || labelledByText($, el) || nonEmpty($(el).children('title').text())) return;
    out.push(issue(locate(ctx, el), 'serious',
      'SVG image has role="img" but no accessible name.',
      'Add an aria-label to the svg, or a <title> element as its first child, describing the image.'));
  });
  return out;
}

// ---------- 1.3.1 Info and Relationships ----------

function checkStructure(ctx) {
  const { $ } = ctx;
  const out = [];
  let previous = null;
  $('h1, h2, h3, h4, h5, h6, [role="heading" i][aria-level]').each((_, el) => {
    const level = /^h[1-6]$/.test(el.name) ? Number(el.name[1]) : Number(el.attribs['aria-level']);
    if (!Number.isInteger(level) || level < 1) return;
    if (previous !== null && level > previous + 1) {
      out.push(issue(locate(ctx, el), 'moderate',
        `Heading level jumps from ${previous} to ${level}, so the outline screen reader users navigate by has a gap.`,
        `Use a level ${previous + 1} heading here, or restructure the headings so each level follows the one above it.`));
    }
    previous = level;
  });
  $('table').each((_, el) => {
    if (isDecorative(el)) return;
    const $t = $(el);
    const rows = $t.find('tr').filter((_, tr) => $(tr).closest('table')[0] === el);
    if (rows.length < 2) return;
    if ($t.find('th, [role="columnheader" i], [role="rowheader" i]').length > 0) return;
    out.push(issue(locate(ctx, el), 'serious',
      'Data table has no header cells, so screen readers cannot announce which row or column a cell belongs to.',
      'Mark the header row or column with <th> elements (with scope="col" or scope="row"). If the table is only for layout, add role="presentation".'));
  });
  return out;
}

// ---------- 1.4.3 Contrast (Minimum) ----------

function parseStylesheets($) {
  const rules = [];
  let order = 0;
  $('style').each((_, el) => {
    const css = $(el).text().replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let start = 0;
    let atRule = false;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') {
        if (depth === 0) {
          const selector = css.slice(start, i).trim();
          atRule = selector.startsWith('@');
          rules.push({ selector, body: null, start: i + 1, atRule });
        }
        depth++;
      } else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          const r = rules[rules.length - 1];
          r.body = css.slice(r.start, i);
          start = i + 1;
        }
        if (depth < 0) { depth = 0; start = i + 1; }
      }
    }
  });
  return rules.filter((r) => !r.atRule && r.body !== null).flatMap((r) =>
    r.selector.split(',').map((s) => s.trim()).filter(Boolean).map((selector) => ({ selector, decls: parseDecls(r.body), order: order++ })));
}

function parseDecls(body) {
  const decls = {};
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (prop && value) decls[prop] = value;
  }
  return decls;
}

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + tags;
}

// Build a map element -> declared properties, applying stylesheet rules by specificity and
// source order, then inline style attributes on top.
function computeDeclared($) {
  const declared = new Map();
  const set = (el, prop, value, weight) => {
    let props = declared.get(el);
    if (!props) declared.set(el, (props = {}));
    const important = /!important\s*$/i.test(value);
    const w = weight + (important ? 1e9 : 0);
    if (!props[prop] || props[prop].w <= w) props[prop] = { value: value.replace(/\s*!important\s*$/i, ''), w };
  };
  for (const rule of parseStylesheets($)) {
    // State-dependent selectors (:hover, ::before ...) do not describe the default rendering.
    if (/:/.test(rule.selector)) continue;
    let matched;
    try { matched = $(rule.selector).get(); } catch { continue; }
    const weight = specificity(rule.selector) * 1000 + rule.order;
    for (const el of matched) for (const [p, v] of Object.entries(rule.decls)) set(el, p, v, weight);
  }
  $('[style]').each((_, el) => {
    for (const [p, v] of Object.entries(parseDecls(el.attribs.style))) set(el, p, v, 1e8);
  });
  return declared;
}

const UA_FONT_EM = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67, small: 0.8 };
const BOLD_TAGS = new Set(['b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th']);

function fontSizePx(value, parentPx) {
  const v = String(value).trim().toLowerCase();
  const m = v.match(/^([\d.]+)(px|pt|em|rem|%)?$/);
  if (m) {
    const n = Number(m[1]);
    switch (m[2]) {
      case 'pt': return n * (4 / 3);
      case 'em': return n * parentPx;
      case 'rem': return n * 16;
      case '%': return (n / 100) * parentPx;
      default: return n;
    }
  }
  const keywords = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 };
  return keywords[v] ?? null;
}

function makeStyleResolver(declared) {
  const cache = new Map();
  const prop = (el, name) => declared.get(el)?.[name]?.value;

  function resolve(el) {
    if (!el || el.type !== 'tag') return { color: [0, 0, 0], background: [255, 255, 255], fontPx: 16, bold: false, hidden: false, unknown: false };
    if (cache.has(el)) return cache.get(el);
    const parent = resolve(el.parent);
    const s = { ...parent };

    const display = prop(el, 'display');
    const visibility = prop(el, 'visibility');
    if (display === 'none' || visibility === 'hidden' || el.attribs.hidden !== undefined) s.hidden = true;

    const color = prop(el, 'color');
    if (color !== undefined && !/^(inherit|unset)$/i.test(color)) {
      const c = parseColor(color);
      if (c) s.color = c; else s.unknown = true;
    } else if (el.name === 'a' && el.attribs.href !== undefined) {
      s.color = [0, 0, 238]; // browsers' default link color (#0000EE)
    }

    const bgImage = prop(el, 'background-image');
    if (bgImage && !/^none$/i.test(bgImage)) s.unknown = true;
    const bg = prop(el, 'background-color') ?? prop(el, 'background');
    if (bg !== undefined && !/^(transparent|inherit|unset|none|initial)$/i.test(bg)) {
      if (/url\(|gradient\(/i.test(bg)) s.unknown = true;
      else {
        const c = parseColor(bg);
        if (c) s.background = c; else s.unknown = true;
      }
    }
    if (prop(el, 'opacity') !== undefined && Number(prop(el, 'opacity')) < 1) s.unknown = true;

    const size = prop(el, 'font-size');
    const px = size !== undefined ? fontSizePx(size, parent.fontPx ?? 16) : UA_FONT_EM[el.name] ? UA_FONT_EM[el.name] * (parent.fontPx ?? 16) : parent.fontPx;
    s.fontPx = px ?? null;

    const weight = prop(el, 'font-weight');
    if (weight !== undefined) s.bold = /^(bold|bolder)$/i.test(weight) || Number(weight) >= 700;
    else if (BOLD_TAGS.has(el.name)) s.bold = true;

    cache.set(el, s);
    return s;
  }
  return resolve;
}

function checkContrast(ctx) {
  const { $ } = ctx;
  const resolve = makeStyleResolver(computeDeclared($));
  const out = [];
  $('body *').each((_, el) => {
    if (SKIP_TEXT_IN.has(el.name) || hasAncestor(el, (n) => n.name === 'svg' || n.name === 'noscript' || n.name === 'template')) return;
    const ownText = (el.children ?? []).filter((n) => n.type === 'text').map((n) => n.data).join('').trim();
    if (!ownText) return;
    if (el.attribs.disabled !== undefined || el.attribs['aria-disabled'] === 'true') return; // inactive controls are exempt
    const s = resolve(el);
    if (s.hidden || s.unknown) return;
    const ratio = contrastRatio(s.color, s.background);
    const needed = requiredRatio(s.fontPx, s.bold);
    if (ratio + 1e-9 < needed) {
      const r = Math.floor(ratio * 100) / 100;
      out.push(issue(locate(ctx, el), 'serious',
        `Text color ${toHex(s.color)} on background ${toHex(s.background)} has a contrast ratio of ${r}:1, below the ${needed}:1 minimum, so it is hard to read for people with low vision.`,
        `Darken the text or lighten the background until the contrast ratio is at least ${needed}:1 (for example, use #595959 or darker text on a white background).`));
    }
  });
  return out;
}

// ---------- 2.4.2 Page Titled ----------

function checkTitle(ctx) {
  const { $ } = ctx;
  const title = $('head > title').first();
  if (title.length && nonEmpty(title.text())) return [];
  const head = $('head')[0];
  return [issue(title.length ? locate(ctx, title[0]) : head?.sourceCodeLocation ? locate(ctx, head) : null, 'serious',
    'The page has no title, so screen reader and browser-tab users cannot tell what the page is.',
    'Add a <title> element inside <head> that describes the page, for example <title>ECE 101 Syllabus</title>.')];
}

// ---------- 2.4.4 Link Purpose ----------

function checkLinks(ctx) {
  const { $ } = ctx;
  const out = [];
  $('a[href]').each((_, el) => {
    if (hasAncestor(el, (n) => n.attribs['aria-hidden'] === 'true')) return;
    const name = accessibleName($, el);
    if (!name) {
      out.push(issue(locate(ctx, el), 'serious',
        'Link has no text, so screen reader users hear only "link" with no destination.',
        'Put descriptive text inside the link, or give an image inside it alt text that says where the link goes.'));
    } else if (VAGUE_LINK_TEXT.test(name.replace(/[.!:]+$/, ''))) {
      out.push(issue(locate(ctx, el), 'moderate',
        `Link text "${name}" does not say where the link goes when read on its own.`,
        'Rewrite the link text to name its destination, for example "Download the Week 1 slides" instead of "click here".'));
    }
  });
  return out;
}

// ---------- 3.1.1 Language of Page ----------

function checkLanguage(ctx) {
  const { $ } = ctx;
  const html = $('html')[0];
  const lang = html?.attribs?.lang ?? html?.attribs?.['xml:lang'];
  const location = html?.sourceCodeLocation ? locate(ctx, html) : null;
  if (!nonEmpty(lang)) {
    return [issue(location, 'serious',
      'The page does not declare its language, so screen readers may mispronounce it.',
      'Add a lang attribute to the html element, for example <html lang="en">.')];
  }
  if (!LANG_CODE.test(lang.trim())) {
    return [issue(location, 'serious',
      `The page language "${lang}" is not a valid language code, so screen readers cannot use it.`,
      'Use a valid BCP 47 language code on the html element, for example lang="en" or lang="es-MX".')];
  }
  return [];
}

// ---------- 4.1.2 Name, Role, Value ----------

function checkNames(ctx) {
  const { $ } = ctx;
  const out = [];
  const labelled = (el) => {
    if (nonEmpty(el.attribs['aria-label']) || labelledByText($, el) || nonEmpty(el.attribs.title)) return true;
    if ($(el).closest('label').length && nonEmpty($(el).closest('label').text())) return true;
    const id = el.attribs.id;
    return Boolean(id && $('label').filter((_, l) => l.attribs.for === id && nonEmpty($(l).text())).length);
  };
  $('input, select, textarea').each((_, el) => {
    const type = (el.attribs.type ?? 'text').toLowerCase();
    if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return;
    if (labelled(el)) return;
    out.push(issue(locate(ctx, el), 'critical',
      'Form field has no label, so screen reader users are not told what to enter.',
      'Add a <label for="..."> that matches the field\'s id, or an aria-label describing the field.'));
  });
  $('button, input[type="button" i], [role="button" i]').each((_, el) => {
    const name = el.name === 'input' ? (el.attribs.value ?? '').trim() || accessibleName($, el) : accessibleName($, el);
    if (name) return;
    out.push(issue(locate(ctx, el), 'critical',
      'Button has no text or label, so screen reader users cannot tell what it does.',
      'Put text inside the button, or add an aria-label naming its action (for example aria-label="Close").'));
  });
  $('iframe').each((_, el) => {
    if (nonEmpty(el.attribs.title) || nonEmpty(el.attribs['aria-label'])) return;
    if (isDecorative(el) || el.attribs['aria-hidden'] === 'true') return;
    out.push(issue(locate(ctx, el), 'serious',
      'Embedded frame has no title, so screen reader users cannot tell what it contains.',
      'Add a title attribute to the iframe describing its content, for example title="Lecture 3 video".'));
  });
  return out;
}

export const htmlRules = [
  { criterion: '1.1.1', run: checkTextAlternatives },
  { criterion: '1.3.1', run: checkStructure },
  { criterion: '1.4.3', run: checkContrast },
  { criterion: '2.4.2', run: checkTitle },
  { criterion: '2.4.4', run: checkLinks },
  { criterion: '3.1.1', run: checkLanguage },
  { criterion: '4.1.2', run: checkNames },
];

export function loadHtml(buffer) {
  const text = buffer.toString('utf8');
  return { text, $: load(text, { sourceCodeLocationInfo: true }) };
}
