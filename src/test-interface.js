// The course testing interface on the system side: POST /test/setup and GET /test/report.
// Kept apart from the project API (src/system.js) so live code coverage measures only project
// code (src/coverage.js leaves this file out).
//
// Sessions are also what gates test fault injection (REQ-09): an /analyze request can ask for a
// simulated failure only by naming a session created here (see faultFor in src/system.js).

import express from 'express';
import { measureCoverage, startSessionCoverage } from './coverage.js';

export function createTestInterfaceRouter(sessions) {
  const router = express.Router();

  router.post('/test/setup', express.json(), async (req, res) => {
    const id = req.body?.session_id;
    if (typeof id !== 'string' || id.length === 0) {
      return res.status(400).json({ message: 'session_id is required.', source: 'system' });
    }
    if (req.body.setup !== undefined && (typeof req.body.setup !== 'object' || req.body.setup === null || Array.isArray(req.body.setup))) {
      return res.status(400).json({ message: 'setup must be an object (use {} when there is no starting data).', source: 'system' });
    }
    if (sessions.has(id)) return res.status(409).json({ message: 'Session already exists.', source: 'system' });
    let since = null;
    try { since = await startSessionCoverage(); } catch { /* coverage is best effort; setup still succeeds */ }
    sessions.set(id, { created_at: new Date().toISOString(), since });
    return res.status(201).json({ session_id: id });
  });

  router.get('/test/report', async (req, res) => {
    const id = req.query.session_id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ message: 'session_id is required.', source: 'system' });
    const s = sessions.get(id);
    if (!s) return res.status(404).json({ message: 'Unknown session.', source: 'system' });
    let measured = null;
    try { measured = await measureCoverage(s.since); } catch { measured = null; }
    const code = measured
      ? {
        covered: measured.covered,
        total: measured.total,
        basis: `Executable source lines of the system's project code (${measured.files.join(', ')}) run by project requests since this session's setup, measured live with V8 precise coverage; the test-interface and tester code are not counted. Reading this report does not change the measurement, and later project requests can raise it. Sessions that overlap in time share the process, so each sees the other's requests.`,
      }
      : {
        covered: null,
        total: null,
        basis: 'Source lines; live coverage is not available in this process (disabled, or the CI coverage tool owns the V8 counters). CI reports line coverage for every commit.',
      };
    return res.json({ session_id: id, coverage: { code } });
  });

  return router;
}
