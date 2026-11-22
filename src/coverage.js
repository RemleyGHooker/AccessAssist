// Live code coverage for the course testing interface.
// V8's built-in precise coverage (through Node's inspector, so nothing extra is installed and no
// file is written) counts which code ran. Each "take" returns the counts since the previous take
// and resets them, so this module folds every take into one record: for each executable line of
// the system's source, the number of the last take in which it ran (its "epoch").
//
//   POST /test/setup  -> takes once (closing everything that ran before) and remembers the epoch.
//   GET  /test/report -> takes again and counts lines whose last run is after the session's epoch.
//
// So a report covers exactly the project requests made since that session's setup; reading it
// does not reset or freeze anything for this or any other session, and later requests can still
// raise the count (course spec, system GET /test/report). Sessions that overlap in time see
// each other's requests, because V8 counts per process, not per request.

import { Session } from 'node:inspector/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_URL = pathToFileURL(fileURLToPath(new URL('.', import.meta.url))).href;
// Measured: the system's project code. Not measured: tester-only files, and the test interface
// itself (its handlers are not project requests, and measuring them would let reading a report
// change the next report).
export const EXCLUDED = new Set(['tester.js', 'cases.js', 'fixtures.js', 'design.js', 'targets.js', 'test-interface.js', 'coverage.js']);
const NOT_EXECUTABLE = /^\s*$|^\s*(\/\/|\/\*|\*)|^[\s{}()[\];,]*$/;

let session = null;
let epoch = 0;
const files = new Map(); // file name -> { starts: Int32Array of line start offsets, lastRun: Int32Array (-1 = never) }

// c8 (CI) uses the same V8 counters through NODE_V8_COVERAGE; taking coverage would reset its
// numbers, so live coverage stays off there. LIVE_COVERAGE=off disables it anywhere.
export function liveCoverageAvailable() {
  return !process.env.NODE_V8_COVERAGE && process.env.LIVE_COVERAGE !== 'off';
}

function fileInfo(name, url) {
  let info = files.get(name);
  if (info) return info;
  let source;
  try { source = readFileSync(fileURLToPath(url), 'utf8'); } catch { return null; }
  const starts = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    // A line counts when it holds code (not blank, a comment, or only brackets); it is judged by
    // the innermost V8 block containing its first non-space character.
    if (!NOT_EXECUTABLE.test(line)) starts.push(offset + line.search(/\S/));
    offset += line.length + 1;
  }
  info = { length: source.length, starts: Int32Array.from(starts), lastRun: new Int32Array(starts.length).fill(-1) };
  files.set(name, info);
  return info;
}

// Take V8's counts since the last take and stamp every line that ran with a new epoch.
async function take() {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  epoch++;
  for (const script of result) {
    if (!script.url.startsWith(SRC_URL)) continue;
    const name = script.url.slice(SRC_URL.length);
    if (EXCLUDED.has(name)) continue;
    const info = fileInfo(name, script.url);
    if (!info) continue;
    const counts = new Int32Array(info.length).fill(-1);
    const ranges = script.functions.flatMap((f) => f.ranges)
      .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, info.length));
    info.starts.forEach((start, i) => { if (counts[start] > 0) info.lastRun[i] = epoch; });
  }
  return epoch;
}

// Called by POST /test/setup. Returns the session's starting epoch, or null when unavailable.
export async function startSessionCoverage() {
  if (!liveCoverageAvailable()) return null;
  if (!session) {
    session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  }
  return take();
}

// Called by GET /test/report: lines of the system's source that ran after `since`.
export async function measureCoverage(since) {
  if (!session || since === null || since === undefined) return null;
  await take();
  let covered = 0;
  let total = 0;
  for (const info of files.values()) {
    total += info.lastRun.length;
    for (const run of info.lastRun) if (run > since) covered++;
  }
  return { covered, total, files: [...files.keys()].sort() };
}
