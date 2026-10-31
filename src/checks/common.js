import { ProcessingLimitError } from '../errors.js';

export function issue(criterion, location, severity, description, suggestedFix) {
  return { wcag_criterion: criterion, location, severity, description, suggested_fix: suggestedFix };
}

export function withinLimit(count, maximum = 50_000) {
  if (count > maximum) throw new ProcessingLimitError('Document complexity exceeds the processing budget.');
}

export function validLanguage(value) {
  if (!value || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value)) return false;
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}

export function contrastRatio(a, b) {
  const luminance = (rgb) => rgb.map((v) => v / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
