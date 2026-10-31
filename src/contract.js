import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const contract = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('binary', true);
ajv.addSchema({ ...contract, $id: 'pod-contract' });
const validators = new Map();
const pointer = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');

export function validateResponse(method, path, status, body) {
  const operation = contract.paths[path]?.[method.toLowerCase()];
  if (!operation?.responses?.[status]) return { valid: false, message: `Undocumented ${method} ${path} response: ${status}` };
  const key = `${method} ${path} ${status}`;
  if (!validators.has(key)) validators.set(key, ajv.compile({
    $ref: `pod-contract#/paths/${pointer(path)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema`,
  }));
  const validate = validators.get(key);
  const valid = validate(body);
  return { valid, message: valid ? 'Response matches OpenAPI.' : ajv.errorsText(validate.errors) };
}
