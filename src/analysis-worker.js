import { workerData, parentPort } from 'node:worker_threads';
import { withinLimit } from './checks/common.js';

try {
  const { mime, wcagLevel } = workerData;
  const buffer = Buffer.from(workerData.buffer);
  let result;
  if (mime === 'text/html') result = (await import('./checks/html.js')).checkHtml(buffer, wcagLevel);
  else if (mime === 'application/pdf') result = await (await import('./checks/pdf.js')).checkPdf(buffer);
  else result = await (await import('./checks/docx.js')).checkDocx(buffer);
  withinLimit(result.issues.length, 1000);
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.constructor.name, message: e.message });
}
