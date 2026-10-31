import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { cases, runCase } from '../src/cases.js';
import { validateResponse } from '../src/contract.js';

const remote = Boolean(process.env.BASE_URL);
const logs = [];
let server;
let base = process.env.BASE_URL?.replace(/\/$/, '');
const started = new Date();
if (!remote) {
  server = createApp({ logger: (entry) => logs.push(entry) }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/system`;
}
const root = base.replace(/\/system$/, '');
const directory = resolve(process.env.EVIDENCE_DIR || `docs/evidence/${remote ? 'remote' : 'local'}`);
await mkdir(directory, { recursive: true });
const report = { started_at: started.toISOString(), started_at_shanghai: started.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
  target: base, execution: remote ? 'deployed service' : 'local source working tree', results: [], operations: [] };
try {
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90_000) });
  report.health = { status: health.status, body: await health.json(), version: health.headers.get('x-app-version') };
  const about = await fetch(`${root}/about`, { signal: AbortSignal.timeout(30_000) });
  report.about = await about.json();
  if (process.env.EXPECTED_SHA && report.about.commit !== process.env.EXPECTED_SHA) {
    throw new Error(`Wrong deployed version: expected ${process.env.EXPECTED_SHA}, received ${report.about.commit || report.health.version}`);
  }
  for (const c of cases) {
    let result;
    if (c.local && remote) result = { outcome: 'skip', message: 'Requires local fault injection.' };
    else {
      if (c.local) process.env.SIMULATE_DEPENDENCY_FAILURE = 'true';
      try { result = await runCase(c, base); }
      finally { delete process.env.SIMULATE_DEPENDENCY_FAILURE; }
    }
    report.results.push({ id: c.id, name: c.name, ac: c.ac, ...result });
    console.log(`${c.id} ${result.outcome}: ${result.message}`);
  }
  const id = `evidence-${started.getTime()}`;
  const probes = [
    ['GET', '/health', undefined], ['GET', '/formats', undefined],
    ['POST', '/test/setup', { session_id: id }], ['POST', '/test/setup', { session_id: id }], ['POST', '/test/setup', {}],
    ['GET', `/test/report?session_id=${id}`, undefined], ['GET', '/test/report?session_id=unknown-evidence-id', undefined], ['GET', '/test/report', undefined],
  ];
  for (const [method, path, body] of probes) {
    const r = await fetch(`${base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const data = await r.json();
    report.operations.push({ method, path, status: r.status, body: data, ...validateResponse(method, path.split('?')[0], r.status, data) });
  }
} catch (error) {
  report.execution_error = error.message;
  process.exitCode = 1;
} finally {
  if (server) await new Promise((r) => server.close(r));
  report.finished_at = new Date().toISOString();
  report.totals = { tests: report.results.length, passed: 0, failed: 0, errors: 0, skipped: 0 };
  const keys = { pass: 'passed', fail: 'failed', error: 'errors', skip: 'skipped' };
  for (const result of report.results) report.totals[keys[result.outcome]]++;
  report.base_commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const files = ['package.json', 'package-lock.json', 'openapi.yaml', 'Dockerfile'];
  const walk = (path) => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${path}/${entry.name}`); else files.push(`${path}/${entry.name}`);
  } };
  for (const path of ['src', 'public', 'test', 'scripts', '.github']) walk(path);
  report.source_manifest = Object.fromEntries(files.sort().map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
  report.source_fingerprint = createHash('sha256').update(JSON.stringify(report.source_manifest)).digest('hex');
  await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2) + '\n');
  if (!remote) await writeFile(`${directory}/requests.jsonl`, logs.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  await writeFile(`${directory}/summary.md`, `# ${remote ? 'Deployed' : 'Local'} validation evidence\n\nStarted: ${report.started_at} (Shanghai: ${report.started_at_shanghai})\n\nTarget: ${base}\n\nVersion: ${report.health?.version || 'unavailable'}\n\nSource fingerprint: \`${report.source_fingerprint}\`\n\n${JSON.stringify(report.totals)}\n\n${report.execution_error || ''}\n\n| Test | Outcome | Evidence |\n| --- | --- | --- |\n${report.results.map((r) => `| ${r.id} | ${r.outcome} | ${r.message.replaceAll('|', '\\|')} |`).join('\n')}\n`);
  console.log(JSON.stringify({ ...report.totals, evidence: directory }));
  if (report.totals.failed || report.totals.errors || report.operations.some((r) => !r.valid)) process.exitCode = 1;
}
