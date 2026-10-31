import express from 'express';
import { fileURLToPath } from 'node:url';
import { createSystemRouter } from './system.js';
import { createTesterRouter } from './tester.js';
import { readFileSync } from 'node:fs';
import { remediationMode } from './remediation.js';

const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const COMMIT = process.env.GIT_SHA && process.env.GIT_SHA !== 'dev' ? process.env.GIT_SHA : null;
const VERSION = COMMIT || process.env.K_REVISION || `local-${APP_VERSION}`;

// One structured JSON log line per request, written to stdout. Cloud Run sends these to Cloud Logging;
// "severity" plus the other fields make errors easy to search and count.
function requestLog(logger) { return (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const entry = {
      timestamp: new Date().toISOString(),
      severity: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO',
      message: `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      error_code: res.locals.errorCode,
      latency_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      version: VERSION,
      revision: process.env.K_REVISION || null,
      commit: COMMIT,
    };
    logger(entry);
  });
  next();
}; }

export function createApp({ analyzeDocument, logger = (entry) => {
  if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify(entry));
} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog(logger));
  app.use((_req, res, next) => { res.set('X-App-Version', VERSION); next(); });

  app.use('/system', createSystemRouter({ analyzeDocument }));
  app.use('/tester', createTesterRouter());
  // A simple upload page for people; the JSON APIs above are for software and testers.
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.get('/about', (_req, res) => res.json({ service: 'AccessAssist (ECE 30861 Team 19)', system: '/system', tester: '/tester', version: VERSION,
    app_version: APP_VERSION, commit: COMMIT, revision: process.env.K_REVISION || null, remediation_mode: remediationMode() }));

  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'No such endpoint.' }));
  // Any unexpected crash still answers in the standard error shape.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request body is not valid JSON.', source: req.originalUrl.startsWith('/tester') ? 'tester' : 'system' });
    res.locals.errorCode = 'INTERNAL_ERROR';
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
  });
  return app;
}
