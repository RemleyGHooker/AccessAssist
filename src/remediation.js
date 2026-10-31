import { DependencyUnavailableError } from './errors.js';

export function remediationMode() { return process.env.REMEDIATION_MODE || 'deterministic'; }

// The provider receives only rule-authored fixes, never upload text, filenames or snippets.
export async function remediate(issues, {
  mode = remediationMode(), apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', fetchImpl = fetch, timeoutMs = 8000,
} = {}) {
  if (!['deterministic', 'groq'].includes(mode)) throw new DependencyUnavailableError('Invalid remediation configuration.');
  if (mode === 'deterministic' || issues.length === 0) return issues;
  if (!apiKey) throw new DependencyUnavailableError('Groq mode requires an API key.');
  const templates = new Map();
  const keyOf = (i) => `${i.wcag_criterion}:${i.suggested_fix}`;
  for (const i of issues) {
    const key = keyOf(i);
    if (!templates.has(key)) templates.set(key, { id: templates.size, criterion: i.wcag_criterion, fix: i.suggested_fix });
  }
  const requests = [...templates.values()];
  try {
    const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0, max_completion_tokens: 4096, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You explain verified accessibility fixes. Return JSON {"suggestions":[{"id":0,"text":"..."}]} with exactly one entry per input id. Write one actionable sentence (20–600 characters) per entry. Do not change criteria, invent image contents, claim compliance, add URLs, or remove requirements. The input contains generic rule templates, not document content.' },
          { role: 'user', content: JSON.stringify(requests) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) throw new Error('Provider response too large');
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const suggestions = JSON.parse(body.choices?.[0]?.message?.content).suggestions;
    if (!Array.isArray(suggestions) || suggestions.length !== requests.length) throw new Error('Incomplete guidance');
    const byId = new Map();
    for (const s of suggestions) {
      if (!Number.isInteger(s.id) || s.id < 0 || s.id >= requests.length || byId.has(s.id)
        || typeof s.text !== 'string' || s.text.trim().length < 20 || s.text.length > 600
        || /https?:|<\/?script|fully compliant|guarantee.*compliance/i.test(s.text)) throw new Error('Invalid guidance');
      byId.set(s.id, s.text.trim());
    }
    return issues.map((i) => ({ ...i,
      suggested_fix: `${i.suggested_fix} Additional guidance (AI-generated; review before use): ${byId.get(templates.get(keyOf(i)).id)}`,
    }));
  } catch { throw new DependencyUnavailableError('The remediation provider did not return a complete valid response.'); }
}
