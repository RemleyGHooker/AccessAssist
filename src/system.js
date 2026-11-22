// The AccessAssist system: the pod's common interface (GET /health, GET /formats,
// POST /analyze) plus the course test endpoints (POST /test/setup, GET /test/report, in
// src/test-interface.js). Every response is JSON and every error uses one shape:
// { code, message } (REQ-13).

import express from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, SUPPORTED, SUPPORTED_MIME_TYPES, resolveType } from './formats.js';
import { analyze, DependencyUnavailableError, EvaluationFailedError, FAULTS, UnprocessableFileError } from './analyzer.js';
import { createTestInterfaceRouter } from './test-interface.js';

const WCAG_LEVELS = ['A', 'AA'];

export function sendError(res, status, code, message) {
  res.locals.errorCode = code;
  return res.status(status).json({ code, message });
}

// Test fault injection (REQ-09 / AC-09), guarded three ways: it needs the X-Test-Fault header,
// an X-Test-Session header naming a session created through POST /test/setup, and it is off
// entirely when FAULT_INJECTION=off. It only changes the answer to that one request, so it
// cannot affect anyone else. Without a live session the headers are ignored.
export function faultFor(req, sessions) {
  if (process.env.FAULT_INJECTION === 'off') return { fault: null };
  const fault = req.get('x-test-fault');
  const session = req.get('x-test-session');
  if (!fault || !session || !sessions.has(session)) return { fault: null };
  if (!FAULTS.includes(fault)) return { error: `X-Test-Fault must be one of: ${FAULTS.join(', ')}.` };
  return { fault };
}

export function createSystemRouter() {
  const router = express.Router();
  const sessions = new Map(); // session_id -> { created_at, since }

  // Answers (results and errors alike) describe one user's upload, so no browser or proxy may
  // keep a copy (REQ-10).
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Files live in memory for one request only and are never written to disk (REQ-10).
  // multer/busboy flags a file whose size EQUALS the limit as too large, but the pod
  // contract allows files of exactly 10 MB. The limit is set one byte higher so that a
  // 10 MB file passes and a 10 MB + 1 byte file is still rejected (caught by test T-11).
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES + 1, files: 1 } });

  // The base URL itself lists the endpoints, so opening it in a browser doesn't look broken.
  router.get('/', (_req, res) => res.json({
    service: 'AccessAssist system (pod common interface)',
    endpoints: ['GET /health', 'GET /formats', 'POST /analyze', 'POST /test/setup', 'GET /test/report'],
  }));

  router.get('/health', (_req, res) => res.json({ status: 'ok' }));

  router.get('/formats', (_req, res) =>
    res.json({ supported_mime_types: SUPPORTED_MIME_TYPES, max_file_size_mb: MAX_FILE_SIZE_MB }));

  router.post('/analyze', (req, res, next) => {
    // Checkpoint 1: size. Oversized files are stopped while they upload (413).
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_TOO_LARGE', `The file is larger than ${MAX_FILE_SIZE_MB} MB.`);
      }
      return sendError(res, 400, 'MISSING_FILE', 'A file is required in the "file" field.');
    });
  }, async (req, res) => {
    // Checkpoint 2: a file is attached and the settings are valid (400).
    if (!req.file) return sendError(res, 400, 'MISSING_FILE', 'A file is required.');
    const wcagLevel = req.body?.wcag_level ?? 'AA';
    if (!WCAG_LEVELS.includes(wcagLevel)) {
      return sendError(res, 400, 'INVALID_WCAG_LEVEL', 'wcag_level must be "A" or "AA".');
    }

    // Checkpoint 3: a file type we accept (415).
    const mime = resolveType(req.file.originalname, req.file.mimetype);
    if (!mime) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported file type. Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}.`);
    }

    // Checkpoint 4: the file can actually be read (422). Never return results for it (REQ-03).
    if (req.file.size === 0 || !SUPPORTED[mime].looksValid(req.file.buffer)) {
      return sendError(res, 422, 'UNPROCESSABLE_FILE', 'The file could not be evaluated.');
    }

    const { fault, error } = faultFor(req, sessions);
    if (error) { req.file.buffer = null; return sendError(res, 400, 'INVALID_TEST_FAULT', error); }
    if (fault) res.locals.fault = fault;

    try {
      const result = await analyze({ mime, buffer: req.file.buffer, wcagLevel, fault });
      return res.json(result);
    } catch (e) {
      if (e instanceof UnprocessableFileError) {
        // The file looked like its type at intake but could not be parsed, or is too complex to
        // evaluate within the service's limits (REQ-03, REQ-12).
        return sendError(res, 422, 'UNPROCESSABLE_FILE',
          e.reason ? `The file could not be evaluated: ${e.reason}` : 'The file could not be evaluated.');
      }
      if (e instanceof DependencyUnavailableError || e instanceof EvaluationFailedError) {
        // Never present partial results as a finished evaluation (REQ-09). Unexpected failures
        // keep their stack trace in the log; injected ones are labeled by the request log.
        if (e instanceof EvaluationFailedError && !fault) {
          console.error(JSON.stringify({ severity: 'ERROR', message: e.cause?.stack || e.stack }));
        }
        return sendError(res, 503, 'PROCESSING_UNAVAILABLE', 'The evaluation could not be completed, so no results are returned. Try again.');
      }
      throw e;
    } finally {
      if (req.file) req.file.buffer = null; // drop the upload as soon as the answer is ready (REQ-10)
    }
  });

  // ---- Course cross-team testing endpoints (src/test-interface.js) ----
  router.use(createTestInterfaceRouter(sessions));

  return router;
}
