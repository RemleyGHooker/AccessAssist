// The AccessAssist system: the pod's common interface (GET /health, GET /formats,
// POST /analyze) plus the course test endpoints (POST /test/setup, GET /test/report).
// Every response is JSON and every error uses one shape: { code, message } (REQ-13).

import express from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, SUPPORTED, SUPPORTED_MIME_TYPES, resolveType } from './formats.js';
import { analyze, DependencyUnavailableError } from './analyzer.js';

const WCAG_LEVELS = ['A', 'AA'];

export function sendError(res, status, code, message) {
  res.locals.errorCode = code;
  return res.status(status).json({ code, message });
}

export function createSystemRouter() {
  const router = express.Router();
  const sessions = new Map(); // session_id -> { created_at }

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

    try {
      const result = await analyze({ mime, buffer: req.file.buffer, wcagLevel });
      return res.json(result);
    } catch (e) {
      if (e instanceof DependencyUnavailableError) {
        // Never present partial results as a finished evaluation (REQ-09).
        return sendError(res, 503, 'PROCESSING_UNAVAILABLE', 'The evaluation service is temporarily unavailable. Try again.');
      }
      throw e;
    } finally {
      req.file.buffer = null; // drop the upload as soon as the answer is ready
    }
  });

  // ---- Course cross-team testing endpoints ----
  router.post('/test/setup', express.json(), (req, res) => {
    const id = req.body?.session_id;
    if (typeof id !== 'string' || id.length === 0) {
      return res.status(400).json({ message: 'session_id is required.', source: 'system' });
    }
    if (sessions.has(id)) return res.status(409).json({ message: 'Session already exists.', source: 'system' });
    sessions.set(id, { created_at: new Date().toISOString() });
    return res.status(201).json({ session_id: id });
  });

  router.get('/test/report', (req, res) => {
    const id = req.query.session_id;
    if (!id) return res.status(400).json({ message: 'session_id is required.', source: 'system' });
    if (!sessions.has(id)) return res.status(404).json({ message: 'Unknown session.', source: 'system' });
    return res.json({
      session_id: id,
      coverage: {
        code: {
          covered: null,
          total: null,
          basis: 'Source lines; live per-session instrumentation is not enabled on the deployed service. CI reports line coverage for every commit.',
        },
      },
    });
  });

  return router;
}
