import express from 'express';
import { createSystemRouter } from './system.js';
import { createTesterRouter } from './tester.js';

const VERSION = process.env.K_REVISION || process.env.GIT_SHA || 'dev';

// One structured JSON log line per request, written to stdout. Cloud Run sends these to Cloud Logging;
// "severity" plus the other fields make errors easy to search and count.
function requestLog(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const entry = {
      severity: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO',
      message: `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      error_code: res.locals.errorCode,
      latency_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      version: VERSION,
    };
    if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify(entry));
  });
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog);
  app.use((_req, res, next) => { res.set('X-App-Version', VERSION); next(); });

  app.use('/system', createSystemRouter());
  app.use('/tester', createTesterRouter());
  app.get('/', (_req, res) => res.json({ service: 'AccessAssist (ECE 30861 Team 19)', system: '/system', tester: '/tester', version: VERSION }));

  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'No such endpoint.' }));
  // Any unexpected crash still answers in the standard error shape.
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ severity: 'ERROR', message: err.stack || String(err) }));
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request body is not valid JSON.', source: 'system' });
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
  });
  return app;
}
