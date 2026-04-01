#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

/**
 * Prompt the user with a question and return their response or a default when input is empty.
 * @param {string} question - The prompt text shown to the user.
 * @param {string} [def=''] - The default value returned when the user submits an empty response.
 * @returns {Promise<string>} A Promise that resolves to the user's input trimmed; if the user enters nothing, the provided default.
 */
async function prompt(question, def = '') {
  const q = def ? `${question} (${def}): ` : `${question}: `;
  const answer = await rl.question(q);
  return (answer || def).trim();
}

/**
 * Convert a string into a camelCase identifier suitable for use as an extension id.
 * @param {string} s - The input string (e.g., display name or package name) to convert.
 * @returns {string} The camelCased identifier; `'extensionId'` if the conversion produces an empty string.
 */
function toCamelCase(s) {
  return (
    s
      .replace(/[^a-zA-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : (word[0]?.toUpperCase() || '') + word.slice(1)
      )
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '') || 'extensionId'
  );
}

function validateInputs({ name, version, id }) {
  const npmNameRe = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
  const semverRe =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const idRe = /^[A-Za-z][A-Za-z0-9]*$/;

  if (!npmNameRe.test(name)) throw new Error(`Invalid npm package name: "${name}"`);
  if (!semverRe.test(version)) throw new Error(`Invalid semver version: "${version}"`);
  if (!idRe.test(id)) throw new Error(`Invalid extension id: "${id}"`);
}

/**
 * Remove all files and directories inside the project's src/ directory except src/01-core.js.
 *
 * Ensures src/ exists before attempting removals; if src/ is missing the function logs a warning and returns.
 * Throws any errors encountered other than a missing src/ directory.
 */
async function removeOtherSrcFiles() {
  const srcDir = path.join(process.cwd(), 'src');
  try {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(srcDir, e.name);
      if (e.isFile()) {
        if (e.name !== '01-core.js') {
          await fs.rm(full);
          console.log(`removed ${path.relative(process.cwd(), full)}`);
        }
      } else if (e.isDirectory()) {
        // remove directories entirely
        await fs.rm(full, { recursive: true, force: true });
        console.log(`removed directory ${path.relative(process.cwd(), full)}`);
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('No src/ directory found — skipping file removal.');
      return;
    }
    throw err;
  }
}

/**
 * Apply the provided key/value pairs to the project's package.json and persist the change.
 * @param {Object} updates - An object whose keys are package.json fields to set and whose values are the new values to write; existing fields will be overwritten and new fields will be added.
 */
async function updatePackageJson(updates) {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  for (const k of Object.keys(updates)) pkg[k] = updates[k];
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('updated package.json');
}

/**
 * Ensures `src/01-core.js` begins with an initialization header containing the display name and author.
 *
 * If the file does not already contain the marker "Initialized by npm run init", the header
 * is prepended; if the file is missing, the function returns without error. Other filesystem
 * errors are propagated.
 *
 * @param {string} displayName - Human-readable name to include in the header.
 * @param {string} author - Author string to include in the header.
 * @throws {Error} Propagates non-ENOENT filesystem errors encountered while reading or writing the file.
 */
async function addHeaderToCore(displayName, author) {
  const corePath = path.join(process.cwd(), 'src', '01-core.js');
  try {
    let content = await fs.readFile(corePath, 'utf8');
    const header = `// ${displayName}\n// Author: ${author}\n// Initialized by npm run init\n\n`;
    if (!content.includes('Initialized by npm run init')) {
      content = header + content;
      await fs.writeFile(corePath, content, 'utf8');
      console.log('updated src/01-core.js with header');
    } else {
      console.log('src/01-core.js already contains an init header — leaving unchanged');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('src/01-core.js not found — skipping header update.');
      return;
    }
    throw err;
  }
}

/**
 * Write a src/manifest.json file containing the provided extension metadata.
 *
 * @param {Object} params - Manifest fields.
 * @param {string} params.name - Extension name to write as `name`.
 * @param {string} params.id - Extension identifier to write as `id`.
 * @param {string} params.version - Version string to write as `version`.
 * @param {string} params.description - Description to write as `description`.
 * @param {string} params.author - Author to write as `author`.
 * @param {string} params.license - License identifier to write as `license`.
 * @param {string} params.url - URL to write as `url`.
 * @throws {Error} If creating the src directory or writing the file fails; the underlying error is rethrown.
 */
async function writeManifest({ name, id, version, description, author, license, url }) {
  const srcDir = path.join(process.cwd(), 'src');
  try {
    await fs.mkdir(srcDir, { recursive: true });
    const manifestPath = path.join(srcDir, 'manifest.json');
    const manifest = { name, id, version, description, author, license, url };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('wrote src/manifest.json');
  } catch (err) {
    console.error('Failed to write manifest.json:', err);
    throw err;
  }
}

/**
 * Run an interactive CLI that initializes a Mint extension project.
 *
 * Prompts the user for package and extension metadata, asks for confirmation,
 * then applies the chosen changes: updates package.json, writes src/manifest.json,
 * removes other files under src/ except src/01-core.js, and ensures an initialization
 * header is present in src/01-core.js. On completion or error the readline
 * interface is closed and the process exits with an appropriate status.
 */
async function main() {
  try {
    console.log('This script will help initialize a Mint extension from the template.');

    const name = await prompt('npm package name (kebab-case)', path.basename(process.cwd()));
    const displayName = await prompt('Extension display name', 'My Mint Extension');
    const description = await prompt('Description', 'A Mint extension');
    const author = await prompt('Author', '');
    const version = await prompt('Initial version', '0.1.0');
    const license = await prompt('License', 'LSL-1.0');
    const url = await prompt('URL (homepage for the extension)', '');
    const defaultId = toCamelCase(displayName || name);
    const id = await prompt('Extension id (camelCase, no spaces)', defaultId);
    validateInputs({ name, version, id });

    console.log('\nThe script will:');
    console.log('- Update package.json with the provided values');
    console.log("- Remove all files in src/ except 'src/01-core.js' (directories will be removed)");
    console.log('- Create src/manifest.json with basic metadata');

    const confirm = (await prompt('Proceed? (yes/no)', 'no')).toLowerCase();
    if (confirm !== 'yes' && confirm !== 'y') {
      console.log('Aborted by user. No changes made.');
      process.exit(0);
    }

    await removeOtherSrcFiles();
    await addHeaderToCore(displayName, author);
    await writeManifest({ name: displayName, id, version, description, author, license, url });
    await updatePackageJson({ name, description, author, version });

    console.log('\nInitialization complete.');
    console.log('Next steps:');
    console.log('- Review package.json, src/manifest.json and src/01-core.js');
    console.log(
      "- Start adding your extension files under src/ (keep '01-core.js' as the core entry)"
    );
  } catch (err) {
    console.error('Error during init:', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
