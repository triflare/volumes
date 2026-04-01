#!/usr/bin/env node

/**
 * Asset manager CLI for Mint extensions.
 *
 * Subcommands:
 *   list            — list all assets in src/assets with type and size
 *   add <file>      — copy a file into src/assets and print usage snippet
 *   remove <name>   — remove an asset after checking for references in src/
 *
 * Usage (via npm scripts):
 *   npm run asset:list
 *   npm run asset:add -- path/to/image.png
 *   npm run asset:remove -- image.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');
const ASSETS_DIR = path.join(SRC_DIR, 'assets');

import { MIME_MAP } from './mime-map.js';

/**
 * Recursively walk a directory and return all file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(d => {
      const res = path.join(dir, d.name);
      return d.isDirectory() ? walk(res) : [res];
    });
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * List all assets in src/assets with their MIME type and size.
 */
function cmdList() {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.log('No assets found (src/assets does not exist).');
    return;
  }

  const files = walk(ASSETS_DIR);
  if (files.length === 0) {
    console.log('No assets found in src/assets.');
    return;
  }

  const rows = files.map(f => {
    const rel = path.relative(ASSETS_DIR, f).replace(/\\/g, '/');
    const ext = path.extname(f).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const size = fs.statSync(f).size;
    return { rel, mime, size };
  });

  const colName = Math.max('Name'.length, ...rows.map(r => r.rel.length));
  const colType = Math.max('Type'.length, ...rows.map(r => r.mime.length));
  const colSize = Math.max('Size'.length, ...rows.map(r => formatBytes(r.size).length));

  const pad = (s, w) => s + ' '.repeat(w - s.length);
  const sep = `+-${'-'.repeat(colName)}-+-${'-'.repeat(colType)}-+-${'-'.repeat(colSize)}-+`;

  console.log(sep);
  console.log(`| ${pad('Name', colName)} | ${pad('Type', colType)} | ${pad('Size', colSize)} |`);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `| ${pad(r.rel, colName)} | ${pad(r.mime, colType)} | ${pad(formatBytes(r.size), colSize)} |`
    );
  }
  console.log(sep);
  console.log(`${rows.length} asset(s) total.`);
}

/**
 * Copy a file into src/assets and print the usage snippet.
 * @param {string} filePath - Path to the file to add.
 */
function cmdAdd(filePath) {
  if (!filePath) {
    console.error('Usage: npm run asset:add -- <file>');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    console.error(`Not a file: ${absPath}`);
    process.exit(1);
  }

  // Ensure src/assets exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    console.log('Created src/assets/');
  }

  const baseName = path.basename(absPath);
  const dest = path.join(ASSETS_DIR, baseName);

  if (fs.existsSync(dest)) {
    console.error(`Asset already exists: src/assets/${baseName}`);
    console.error('Remove it first with:  npm run asset:remove -- ' + baseName);
    process.exit(1);
  }

  fs.copyFileSync(absPath, dest);

  const ext = path.extname(baseName).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  const size = fs.statSync(dest).size;

  console.log(`✓ Added src/assets/${baseName}  (${mime}, ${formatBytes(size)})`);
  console.log('');
  console.log('Usage snippet:');
  console.log(`  __ASSET__('${baseName}')`);
}

/**
 * Scan all JS source files for __ASSET__('name') references.
 * @param {string} assetName - Relative asset path to search for.
 * @returns {string[]} List of source files that reference the asset.
 */
function findReferences(assetName) {
  if (!fs.existsSync(SRC_DIR)) return [];

  const jsFiles = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('.'))
    .map(f => path.join(SRC_DIR, f));

  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('__ASSET__\\s*\\(\\s*([\'"])' + escaped + '\\1\\s*\\)');

  return jsFiles.filter(f => pattern.test(fs.readFileSync(f, 'utf8')));
}

/**
 * Remove an asset from src/assets after checking for references in src/.
 * @param {string} assetName - File name (or relative path) of the asset to remove.
 */
function cmdRemove(assetName) {
  if (!assetName) {
    console.error('Usage: npm run asset:remove -- <name>');
    process.exit(1);
  }

  const assetPath = path.join(ASSETS_DIR, assetName);
  if (!fs.existsSync(assetPath)) {
    console.error(`Asset not found: src/assets/${assetName}`);
    process.exit(1);
  }

  // Safety check — look for __ASSET__('assetName') in source files
  const refs = findReferences(assetName);
  if (refs.length > 0) {
    console.error(`✗ Cannot remove '${assetName}' — it is still referenced in:`);
    for (const r of refs) {
      console.error(`  ${path.relative(process.cwd(), r)}`);
    }
    console.error('Remove or update those references first, then run this command again.');
    process.exit(1);
  }

  fs.rmSync(assetPath, { force: true });
  console.log(`✓ Removed src/assets/${assetName}`);
}

// --- CLI entry point ---
const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case 'list':
    cmdList();
    break;
  case 'add':
    cmdAdd(rest[0]);
    break;
  case 'remove':
    cmdRemove(rest[0]);
    break;
  default:
    console.error('Unknown subcommand:', subcommand ?? '(none)');
    console.error('');
    console.error('Available subcommands:');
    console.error('  list              List assets in src/assets with type and size');
    console.error('  add <file>        Copy a file into src/assets and print usage snippet');
    console.error('  remove <name>     Remove an asset (aborts if still referenced in src/)');
    process.exit(1);
}
