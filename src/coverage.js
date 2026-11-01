// Live code coverage for the course testing interface (closes Phase 3 LIM-05).
// POST /test/setup starts (or resets) V8's built-in precise coverage; GET /test/report then
// counts which lines of src/ ran since that setup. It uses Node's inspector, so nothing
// extra is installed and no file is written. Sessions that overlap in time share the same
// counters, which the report's "basis" states.

import { Session } from 'node:inspector/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_URL = pathToFileURL(fileURLToPath(new URL('.', import.meta.url))).href;
// Tester-only files are not part of the system under test.
const EXCLUDED = new Set(['tester.js', 'cases.js', 'fixtures.js']);
let session = null;

// c8 (CI) uses the same V8 counters through NODE_V8_COVERAGE; resetting them would corrupt
// its numbers, so live coverage stays off there. LIVE_COVERAGE=off disables it anywhere.
export function liveCoverageAvailable() {
  return !process.env.NODE_V8_COVERAGE && process.env.LIVE_COVERAGE !== 'off';
}

export async function startOrResetCoverage() {
  if (!liveCoverageAvailable()) return false;
  if (!session) {
    session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  } else {
    await session.post('Profiler.takePreciseCoverage'); // taking coverage resets the counters
  }
  return true;
}

const NOT_EXECUTABLE = /^\s*$|^\s*(\/\/|\/\*|\*)|^[\s{}()[\];,]*$/;

// Line coverage for the system's files under src/: a line counts when it holds code (not blank, a
// comment, or only brackets) and the innermost V8 block containing its first character ran.
export async function measureCoverage() {
  if (!session) return null;
  const { result } = await session.post('Profiler.takePreciseCoverage');
  let covered = 0;
  let total = 0;
  const files = [];
  for (const script of result) {
    if (!script.url.startsWith(SRC_URL) || EXCLUDED.has(script.url.slice(SRC_URL.length))) continue;
    let source;
    try { source = readFileSync(fileURLToPath(script.url), 'utf8'); } catch { continue; }
    const counts = new Int32Array(source.length).fill(-1);
    const ranges = script.functions.flatMap((f) => f.ranges)
      .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, source.length));
    let offset = 0;
    let fileCovered = 0;
    let fileTotal = 0;
    for (const line of source.split('\n')) {
      if (!NOT_EXECUTABLE.test(line)) {
        const first = offset + line.search(/\S/);
        fileTotal++;
        if (counts[first] > 0) fileCovered++;
      }
      offset += line.length + 1;
    }
    covered += fileCovered;
    total += fileTotal;
    files.push(script.url.slice(SRC_URL.length));
  }
  return { covered, total, files: files.sort() };
}
