// The Team 19 tester service, following the course cross-team testing interface:
// POST /test/setup, POST /test/run, GET /test/report.
// Reports are kept in memory until this instance stops, as the course spec allows.
//
// Phase 5: target_url is checked before any request is sent (src/targets.js, LIM-07), and when
// the target is Team 19's own system the report adds coverage.model (src/design.js) and runs the
// Team 19 design checks; cross-team reports omit both.

import express from 'express';
import { randomUUID } from 'node:crypto';
import { cases, runCase, COMPONENTS, TOTAL_ACCEPTANCE_CRITERIA } from './cases.js';
import { modelCoverage } from './design.js';
import { checkTarget, isOwnSystem } from './targets.js';

// Hosts that sleep when idle can take up to ~60 s to wake, so setup waits up to 90 s for the
// target before giving up.
const SETUP_TIMEOUT_MS = 90_000;
const REPORT_TIMEOUT_MS = 10_000;

const base = (url) => url.replace(/\/$/, '');
const SOURCES = ['tester', 'system', 'communication', 'unknown'];

export function createTesterRouter() {
  const router = express.Router();
  router.use(express.json());
  // session_id -> { target_url, own, state: 'ready'|'running'|'done'|'aborted', report }
  const sessions = new Map();

  router.get('/', (_req, res) => res.json({
    service: 'AccessAssist tester (course testing interface)',
    endpoints: ['POST /test/setup', 'POST /test/run', 'GET /test/report'],
  }));

  router.post('/test/setup', async (req, res) => {
    const target = req.body?.target_url;
    const refused = await checkTarget(target);
    if (refused) return res.status(refused.status).json({ message: refused.message, source: refused.source });

    const session_id = randomUUID();
    let answer;
    try {
      answer = await fetch(`${base(target)}/test/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id, setup: {} }),
        redirect: 'manual',
        signal: AbortSignal.timeout(SETUP_TIMEOUT_MS),
      });
    } catch (e) {
      return res.status(500).json({ message: `Could not reach the target system: ${e.cause?.message ?? e.message}`, source: 'communication' });
    }
    const body = await answer.json().catch(() => null);
    if (answer.status !== 201) {
      // Forward the system's failure with the same status, message and source.
      if (answer.status >= 400) {
        return res.status(answer.status).json({
          message: typeof body?.message === 'string' && body.message ? body.message : `System setup returned ${answer.status}.`,
          source: SOURCES.includes(body?.source) ? body.source : 'system',
        });
      }
      return res.status(500).json({ message: `System setup answered ${answer.status} instead of 201, so the target is not ready.`, source: 'system' });
    }
    if (body?.session_id !== session_id) {
      return res.status(500).json({ message: `System setup returned session_id ${JSON.stringify(body?.session_id)} instead of ${session_id}.`, source: 'system' });
    }
    sessions.set(session_id, { target_url: target, own: isOwnSystem(target, req), state: 'ready', report: null });
    return res.status(201).json({ session_id });
  });

  router.post('/test/run', async (req, res) => {
    const id = req.body?.session_id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ message: 'session_id is required.', source: 'tester' });
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ message: 'Unknown session.', source: 'tester' });
    if (s.state !== 'ready') return res.status(409).json({ message: 'This session has already been run. Create a new session.', source: 'tester' });

    s.state = 'running';
    const results = [];
    const ctx = { sessionId: id, own: s.own };
    let current = null;
    try {
      for (const c of cases) {
        current = c;
        const r = await runCase(c, s.target_url, ctx);
        results.push({ test_id: c.id, ...r });
      }
      current = null;
      s.report = await buildReport(id, s, results);
      s.state = 'done';
      return res.json(s.report);
    } catch (e) {
      // Keep what was recorded: the test running at the abort is an error from the tester, and
      // tests not yet started are skipped (course spec, execution rules).
      const done = new Set(results.map((r) => r.test_id));
      for (const c of cases) {
        if (done.has(c.id)) continue;
        results.push(c === current
          ? { test_id: c.id, outcome: 'error', source: 'tester', message: `${c.name}: prevented by the tester abort (${e.message}).` }
          : { test_id: c.id, outcome: 'skip', message: `${c.name}: not executed because the tester aborted.` });
      }
      s.report = await buildReport(id, s, results).catch(() => ({ session_id: id, target_url: s.target_url, results, coverage: unavailableCoverage(s.own) }));
      s.state = 'aborted';
      return res.status(500).json({ message: `Tester aborted: ${e.message}`, source: 'tester' });
    }
  });

  router.get('/test/report', (req, res) => {
    const id = req.query.session_id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ message: 'session_id is required.', source: 'tester' });
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ message: 'Unknown session.', source: 'tester' });
    if (!s.report) return res.status(409).json({ message: 'The suite has not finished yet. Try again later.', source: 'tester' });
    return res.json(s.report);
  });

  return router;
}

function wellFormed(m) {
  if (!m || typeof m.basis !== 'string' || !m.basis.trim()) return false;
  if (m.covered === null && m.total === null) return true;
  return Number.isInteger(m.covered) && Number.isInteger(m.total) && m.covered >= 0 && m.covered <= m.total;
}

function unavailableCoverage(own) {
  const none = (why) => ({ covered: null, total: null, basis: why });
  const out = {
    code: none('Not collected because the tester aborted.'),
    component: none('Not computed because the tester aborted.'),
    system: none('Not computed because the tester aborted.'),
  };
  if (own) out.model = none('Not computed because the tester aborted.');
  return out;
}

async function buildReport(session_id, s, results) {
  const evaluated = new Set(results.filter((r) => r.outcome === 'pass' || r.outcome === 'fail').map((r) => r.test_id));
  const ran = cases.filter((c) => evaluated.has(c.id));
  // The test interface counts as exercised once system /test/setup succeeded and its report was
  // read by a test that reached a verdict (T-33).
  const components = new Set(ran.map((c) => c.component));
  const acs = new Set(ran.flatMap((c) => c.ac));

  let code = { covered: null, total: null, basis: 'Source lines; the target did not report code coverage.' };
  try {
    const r = await fetch(`${base(s.target_url)}/test/report?session_id=${encodeURIComponent(session_id)}`, { redirect: 'manual', signal: AbortSignal.timeout(REPORT_TIMEOUT_MS) });
    if (r.ok) {
      const reported = (await r.json())?.coverage?.code;
      code = wellFormed(reported)
        ? { covered: reported.covered, total: reported.total, basis: reported.basis }
        : { covered: null, total: null, basis: `Source lines; the target's /test/report coverage.code was malformed: ${JSON.stringify(reported)?.slice(0, 200)}` };
    } else {
      code.basis = `Source lines; the target's /test/report answered HTTP ${r.status}.`;
    }
  } catch (e) {
    code.basis = `Source lines; the target's /test/report could not be read (${e.message}).`;
  }

  const coverage = {
    code,
    component: { covered: components.size, total: COMPONENTS.length, basis: `Pod components exercised by at least one executed (pass/fail) test: ${COMPONENTS.join(', ')}.` },
    system: { covered: acs.size, total: TOTAL_ACCEPTANCE_CRITERIA, basis: 'Pod acceptance criteria AC-01 to AC-13 evaluated by at least one executed (pass/fail) test; each criterion counted once.' },
  };
  // Model coverage only when testing our own system (course spec, Phase 5); omitted cross-team.
  if (s.own) coverage.model = modelCoverage(results);
  return { session_id, target_url: s.target_url, results, coverage };
}
