import { JSDOM, VirtualConsole } from 'jsdom';
import { issue, withinLimit, validLanguage, contrastRatio } from './common.js';

function color(value) {
  if (value === 'transparent') return [0, 0, 0, 0];
  if (value === 'canvastext') return [0, 0, 0, 1];
  if (value === 'canvas') return [255, 255, 255, 1];
  const match = value?.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)] : null;
}

const composite = (foreground, background) => foreground.slice(0, 3)
  .map((v, i) => v * foreground[3] + background[i] * (1 - foreground[3]));

export function checkHtml(buffer, wcagLevel) {
  // No runScripts, resources, or document URL: uploaded code and remote resources never run/load.
  const dom = new JSDOM(buffer.toString('utf8'), { includeNodeLocations: true, virtualConsole: new VirtualConsole() });
  const { document } = dom.window;
  const issues = [];
  const styles = new WeakMap();
  const style = (el) => {
    if (!styles.has(el)) styles.set(el, dom.window.getComputedStyle(el));
    return styles.get(el);
  };
  const hidden = (el) => {
    for (let p = el; p; p = p.parentElement) {
      if (p.hidden || p.getAttribute('aria-hidden') === 'true' || style(p).display === 'none'
        || ['hidden', 'collapse'].includes(style(p).visibility)) return true;
    }
    return false;
  };
  const name = (el, seen = new Set()) => {
    if (seen.has(el)) return '';
    seen.add(el);
    const refs = el.getAttribute('aria-labelledby');
    if (refs) {
      const text = refs.trim().split(/\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((target) => name(target, seen)).join(' ').trim();
      if (text) return text;
    }
    const authorName = el.getAttribute('aria-label') || el.getAttribute('alt');
    return (authorName || (el.getAttribute('role') === 'img' ? '' : el.textContent) || '').trim();
  };
  const location = (el) => {
    const node = dom.nodeLocation(el);
    const result = { selector: el.id ? `#${el.id}` : el.localName };
    if (node) result.line = node.startLine;
    result.snippet = el.outerHTML.slice(0, 160);
    return result;
  };
  const add = (el, criterion, severity, description, fix) => {
    issues.push(issue(criterion, location(el), severity, description, fix));
    withinLimit(issues.length, 1000);
  };
  try {
    const elements = [...document.querySelectorAll('*')];
    withinLimit(elements.length);
    const root = document.documentElement;
    if (!validLanguage(root.getAttribute('lang')?.trim())) {
      add(root, '3.1.1', 'serious', 'The document has no valid default language.',
        'Set the html lang attribute to the document language, for example lang="en" for English.');
    }
    if (!document.title.trim()) {
      add(document.querySelector('title') || document.head, '2.4.2', 'moderate', 'The document has no descriptive title.',
        'Add a non-empty title element that identifies the document topic or purpose.');
    }
    for (const el of document.querySelectorAll('img, input[type="image"], [role="img"]')) {
      if (hidden(el)) continue;
      const decorative = el.localName === 'img' && el.hasAttribute('alt') && el.getAttribute('alt') === ''
        && !el.closest('a, button') && !el.hasAttribute('tabindex');
      if (!decorative && !name(el)) {
        add(el, '1.1.1', 'critical', 'An image has no usable text alternative.',
          'Provide a text alternative that conveys the image purpose. Use alt="" only for a purely decorative image; describe functional images by their action.');
      }
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"]), select, textarea')) {
      if (hidden(el)) continue;
      const label = [...(el.labels || [])].some((item) => item.textContent.trim());
      const ariaName = (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) && name(el);
      if (!label && !ariaName && !el.title.trim()) {
        add(el, '1.3.1', 'serious', 'A form control has no programmatically associated label.',
          'Add a visible label and associate it with the control using matching label for and input id attributes, or a wrapping label.');
      }
    }
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="button"]')) {
      if (hidden(el)) continue;
      const childImageName = [...el.querySelectorAll('img')].map((img) => name(img)).join(' ').trim();
      if (!name(el) && !childImageName && !el.getAttribute('value')?.trim() && !el.title.trim()) {
        add(el, '4.1.2', 'serious', 'An interactive element has no accessible name.',
          'Add descriptive visible text or an aria-label that identifies the link or button action.');
      }
    }
    for (const el of document.querySelectorAll('[role="heading"]')) {
      if (!hidden(el) && !/^h[1-6]$/.test(el.localName) && !/^[1-9]\d*$/.test(el.getAttribute('aria-level') || '')) {
        add(el, '1.3.1', 'moderate', 'A custom heading does not specify its semantic level.',
          'Use a native h1–h6 element at the correct level, or set a positive aria-level on the heading.');
      }
    }
    if (wcagLevel === 'AA') {
      for (const el of elements) {
        if (!['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT'].includes(el.tagName)
          && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          && !hidden(el) && !el.closest(':disabled')) {
          const foreground = color(style(el).color.toLowerCase());
          if (!foreground) continue;
          const ancestors = [];
          for (let p = el; p; p = p.parentElement) ancestors.unshift(p);
          let background = [255, 255, 255], supported = true;
          for (const p of ancestors) {
            const s = style(p);
            if ((s.backgroundImage && s.backgroundImage !== 'none') || (s.opacity !== '' && Number(s.opacity) < 1)) { supported = false; break; }
            const bg = color(s.backgroundColor.toLowerCase());
            if (!bg) { supported = false; break; }
            background = composite(bg, background);
          }
          if (!supported) continue;
          const sizeText = style(el).fontSize;
          if (sizeText && !/^\d+(?:\.\d+)?px$/.test(sizeText)) continue;
          const size = Number.parseFloat(sizeText) || 16;
          const weight = style(el).fontWeight;
          const bold = weight === 'bold' || Number(weight) >= 700;
          const required = size >= 24 || (size >= 18.6666666667 && bold) ? 3 : 4.5;
          const ratio = contrastRatio(composite(foreground, background), background);
          if (ratio < required) {
            add(el, '1.4.3', 'serious', `Text contrast is ${ratio.toFixed(2)}:1; this text requires at least ${required}:1.`,
              `Change the foreground or solid background color to reach at least ${required}:1 contrast; preserve readable text in all states.`);
          }
        }
      }
    }
    return {
      issues,
      checks_run: ['1.1.1', '1.3.1', '2.4.2', '3.1.1', '4.1.2', ...(wcagLevel === 'AA' ? ['1.4.3'] : [])],
      scope: 'HTML checks cover text alternatives, labels, custom heading levels, title, language, accessible names, and (AA) static solid-color text contrast. Scripts, external CSS, gradients, images behind text, and visual reading order require manual review.',
    };
  } finally { dom.window.close(); }
}
