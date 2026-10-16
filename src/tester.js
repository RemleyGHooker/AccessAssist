// The Team 19 tester service, following the course cross-team testing interface:
// POST /test/setup, POST /test/run, GET /test/report.
// Reports are kept in memory until this instance stops, as the course spec allows.

import express from 'express';
import { randomUUID } from 'node:crypto';
import { cases, runCase, COMPONENTS, TOTAL_ACCEPTANCE_CRITERIA } from './cases.js';

const SETUP_TIMEOUT_MS = 30_000;

export function createTesterRouter() {
  const router = express.Router();
  router.use(express.json());
  const sessions = new Map(); // session_id -> { target_url, state: 'ready'|'running'|'done'|'aborted', report }

  router.post('/test/setup', async (req, res) => {
    const target = req.body?.target_url;
    if (typeof target !== 'string' || !/^https?:\/\/[^\s?#]+$/.test(target)) {
      return res.status(400).json({ message: 'target_url must be an http(s) base URL with no query or fragment.', source: 'tester' });
    }
    const session_id = randomUUID();
    let res2;
    try {
      res2 = await fetch(target.replace(/\/$/, '') + '/test/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id, setup: {} }),
        signal: AbortSignal.timeout(SETUP_TIMEOUT_MS),
      });
    } catch (e) {
      return res.status(500).json({ message: `Could not reach the target system: ${e.message}`, source: 'communication' });
    }
    if (res2.status !== 201) {
      // Forward the system's failure with the same status, message and source.
      const body = await res2.json().catch(() => ({}));
      return res.status(res2.status).json({ message: body.message || `System setup returned ${res2.status}.`, source: body.source || 'system' });
    }
    sessions.set(session_id, { target_url: target, state: 'ready', report: null });
    return res.status(201).json({ session_id });
  });

  router.post('/test/run', async (req, res) => {
    const id = req.body?.session_id;
    if (!id) return res.status(400).json({ message: 'session_id is required.', source: 'tester' });
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ message: 'Unknown session.', source: 'tester' });
    if (s.state !== 'ready') return res.status(409).json({ message: 'This session has already been run. Create a new session.', source: 'tester' });

    s.state = 'running';
    const results = [];
    try {
      for (const c of cases) {
        if (c.local) {
          results.push({ test_id: c.id, outcome: 'skip', message: `${c.name}: needs fault injection inside the target, so it runs only in Team 19 CI.` });
          continue;
        }
        const r = await runCase(c, s.target_url);
        results.push({ test_id: c.id, ...r });
      }
      s.report = await buildReport(id, s.target_url, results);
      s.state = 'done';
      return res.json(s.report);
    } catch (e) {
      // Keep what was recorded; mark the rest as prevented or skipped.
      const done = new Set(results.map((r) => r.test_id));
      for (const c of cases) {
        if (!done.has(c.id)) results.push({ test_id: c.id, outcome: 'skip', message: `${c.name}: not executed because the tester aborted.` });
      }
      s.report = await buildReport(id, s.target_url, results);
      s.state = 'aborted';
      return res.status(500).json({ message: `Tester aborted: ${e.message}`, source: 'tester' });
    }
  });

  router.get('/test/report', (req, res) => {
    const id = req.query.session_id;
    if (!id) return res.status(400).json({ message: 'session_id is required.', source: 'tester' });
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ message: 'Unknown session.', source: 'tester' });
    if (!s.report) return res.status(409).json({ message: 'The suite has not finished yet. Try again later.', source: 'tester' });
    return res.json(s.report);
  });

  return router;
}

async function buildReport(session_id, target_url, results) {
  const executed = results.filter((r) => r.outcome === 'pass' || r.outcome === 'fail');
  const executedIds = new Set(executed.map((r) => r.test_id));
  const ran = cases.filter((c) => executedIds.has(c.id));
  const components = new Set(ran.map((c) => c.component));
  const acs = new Set(ran.flatMap((c) => c.ac));

  let code = { covered: null, total: null, basis: 'Target did not report code coverage.' };
  try {
    const r = await fetch(`${target_url.replace(/\/$/, '')}/test/report?session_id=${encodeURIComponent(session_id)}`, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) code = (await r.json())?.coverage?.code ?? code;
  } catch { /* keep the default basis */ }

  return {
    session_id,
    target_url,
    results,
    coverage: {
      code,
      component: { covered: components.size, total: COMPONENTS.length, basis: `Pod components exercised by a pass/fail test: ${COMPONENTS.join(', ')} (test-interface is exercised by setup itself and not counted).` },
      system: { covered: acs.size, total: TOTAL_ACCEPTANCE_CRITERIA, basis: 'Pod acceptance criteria AC-01 to AC-13 exercised by at least one executed test.' },
    },
  };
}
