import { Worker } from 'node:worker_threads';
import { UnprocessableFileError, DependencyUnavailableError } from './errors.js';
import { remediate } from './remediation.js';

export { DependencyUnavailableError } from './errors.js';
const MAX_ACTIVE = 2;
let active = 0;

// Each request owns a bounded worker. Termination discards the parsed document and stops CPU-heavy inputs.
function runChecks(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), {
      workerData: data, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => finish(new DependencyUnavailableError('Analysis exceeded its 15-second processing budget.')), 15_000);
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().then(() => err ? reject(err) : resolve(result), reject);
    };
    worker.once('message', (message) => {
      if (message.error) {
        const ErrorType = message.error === 'UnprocessableFileError' ? UnprocessableFileError : DependencyUnavailableError;
        finish(new ErrorType(message.message));
      } else finish(null, message.result);
    });
    worker.once('error', () => finish(new DependencyUnavailableError('Analysis worker failed.')));
    worker.once('exit', () => { if (!settled) finish(new DependencyUnavailableError('Analysis worker stopped without a result.')); });
  });
}

export async function analyze({ mime, buffer, wcagLevel }) {
  if (process.env.NODE_ENV === 'test' && process.env.SIMULATE_DEPENDENCY_FAILURE === 'true') {
    throw new DependencyUnavailableError('Simulated dependency outage');
  }
  if (active >= MAX_ACTIVE) throw new DependencyUnavailableError('Analysis capacity is busy.');
  active++;
  try {
    const { issues, checks_run, scope } = await runChecks({ mime, buffer, wcagLevel });
    const finalIssues = await remediate(issues);
    return {
      wcag_level: wcagLevel, issues: finalIssues, checks_run,
      no_violations_detected: finalIssues.length === 0,
      message: `${finalIssues.length === 0 ? 'No supported violations were detected. ' : ''}${scope} This does not certify full ADA or WCAG compliance.`,
    };
  } finally { active--; }
}
