import fs from 'fs';
import path from 'path';
import process from 'process';

const DEFAULT_MINTRC_PATH = '.mintrc.json';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function loadMintRc(cwd = process.cwd()) {
  const configPath = path.resolve(cwd, DEFAULT_MINTRC_PATH);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Failed to parse JSON in ${configPath}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${DEFAULT_MINTRC_PATH} must contain a JSON object.`);
  }

  const lintRules = parsed.lint?.rules;
  if (lintRules !== undefined && !isPlainObject(lintRules)) {
    throw new TypeError('Expected .mintrc.json lint.rules to be a plain object.');
  }

  return parsed;
}
