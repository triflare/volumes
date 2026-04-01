#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { validateOpcodeSignatures } from './validate.js';
import { validateAssetReferences } from './validate-assets.js';
import { MIME_MAP } from './mime-map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, '../src');
const BUILD_DIR = path.join(__dirname, '../build');
const OUTPUT_FILE = path.join(BUILD_DIR, 'extension.js');
const OUTPUT_MIN_FILE = path.join(BUILD_DIR, 'min.extension.js');
const OUTPUT_MAX_FILE = path.join(BUILD_DIR, 'pretty.extension.js');
const OUTPUT_REPORT_FILE = path.join(BUILD_DIR, 'BUILD_REPORT.md');

// Bundle size threshold (in bytes) above which the minified output is recommended for production
const RECOMMEND_MIN_THRESHOLD_BYTES = 50 * 1024; // 50 KB

// Width (in characters) of the failure/recovery banner lines
const BANNER_WIDTH = 62;

// Check for --watch / --notify / --production flags early so helper functions can read them
const watchMode = process.argv.includes('--watch');
const notifyMode = process.argv.includes('--notify');
const productionMode =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';

// --- Build State Guard ---
let isBuilding = false;
let pendingBuild = false;

// Track whether the last build failed so a recovery message can be shown
let lastBuildFailed = false;

// Create build directory if it doesn't exist
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

/**
 * Send an optional desktop notification (cross-platform best-effort).
 * Only fires when the --notify flag is present.
 * @param {string} title
 * @param {string} message
 */
function sendNotification(title, message) {
  if (!notifyMode) return;

  if (process.platform === 'darwin') {
    const script = `display notification "${message}" with title "${title}"`;
    execFile('osascript', ['-e', script], () => {});
  } else if (process.platform === 'win32') {
    const psScript =
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null;` +
      `$t = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]::new();` +
      `$t.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${title}</text><text id="2">${message}</text></binding></visual></toast>');` +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mint').Show([Windows.UI.Notifications.ToastNotification]::new($t))`;
    execFile('powershell', ['-command', psScript], () => {});
  } else {
    execFile('notify-send', [title, message], () => {});
  }
}

/**
 * Print a highlighted, prominent failure banner to stderr.
 * @param {string} message - Root cause description.
 */
function printFailureBanner(message) {
  const bar = '═'.repeat(BANNER_WIDTH);

  // Calculate content width (account for visual prefix/suffix: 2 spaces on each side = 4 chars)
  const headerLabel = '✗ BUILD FAILED';
  const visiblePrefixSuffixLength = 4; // 2 spaces before + 2 spaces after
  const contentWidth = BANNER_WIDTH - visiblePrefixSuffixLength;

  // Center the label within the content width
  const totalPadding = contentWidth - headerLabel.length;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  const paddedHeader = ' '.repeat(leftPadding) + headerLabel + ' '.repeat(rightPadding);

  console.error(`\x1b[41m\x1b[97m\x1b[1m  ${paddedHeader}  \x1b[0m`);
  console.error(`\x1b[31m${bar}\x1b[0m`);
  console.error(`\x1b[31m  Root cause: ${message}\x1b[0m`);
  console.error(`\x1b[31m${bar}\x1b[0m`);
}

/**
 * Print a highlighted recovery banner when a build succeeds after a failure.
 */
function printRecoveryBanner() {
  console.log(
    `\x1b[42m\x1b[30m\x1b[1m  ✓ BUILD RECOVERED — errors resolved, build is passing again  \x1b[0m`
  );
}

/**
 * Read manifest file if it exists
 */
function getManifest() {
  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_err) {
      console.warn('Warning: Could not parse manifest.json');
      return {};
    }
  }
  return {};
}

/**
 * Generate Scratch extension header
 */
function generateHeader(manifest) {
  const metadata = {
    name: manifest.name || 'My Extension',
    id: manifest.id || 'myExtension',
    description: manifest.description || 'A TurboWarp extension',
    by: manifest.author || 'Anonymous',
    version: manifest.version || '1.0.0',
    license: manifest.license || 'MIT',
    url: manifest.url || 'https://example.com/my-extension',
  };

  let header = '';
  header += `// Name         :  ${metadata.name}\n`;
  header += `// ID           :  ${metadata.id}\n`;
  header += `// Description  :  ${metadata.description}\n`;
  header += `// By           :  ${metadata.by}\n`;
  header += `// License      :  ${metadata.license}\n`;
  header += `\n`;
  header += `// Version      :  ${metadata.version}\n`;
  header += `\n`;
  header += `// This file was generated by Mint, the new bundling toolchain for custom TurboWarp extensions.\n`;
  header += `// It is not recommended to edit this file on your own.\n`;
  header += `// Instead, edit it in this repository: ${metadata.url}\n`;
  header += '\n';

  return header;
}

/**
 * Get all JS files from src directory in order
 */
function getSourceFiles() {
  const files = fs
    .readdirSync(SRC_DIR)
    .filter(file => file.endsWith('.js') && !file.startsWith('.'))
    .sort();

  return files.map(file => path.join(SRC_DIR, file));
}

/**
 * Generate a Markdown build report summarising output sizes and recommending an artifact.
 *
 * Recommendation logic (deterministic):
 *   - When standard output is >= RECOMMEND_MIN_THRESHOLD_BYTES AND min artifact was generated → recommend minified for production.
 *   - Otherwise → recommend standard for production.
 *   - Always recommend pretty output for debugging (when generated).
 *
 * @param {{ standard: number|null, min: number|null, pretty: number|null }} sizes - byte counts for each artifact (null = not generated)
 */
function generateBuildReport(sizes) {
  const formatBytes = bytes =>
    bytes !== null ? `${(bytes / 1024).toFixed(2)} KB` : '_not generated_';

  const standardBytes = sizes.standard;
  const minAvailable = sizes.min !== null;
  const prettyAvailable = sizes.pretty !== null;
  const recommendProd =
    standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && minAvailable
      ? '`min.extension.js`'
      : '`extension.js`';

  const rows = [
    [
      '`extension.js`',
      formatBytes(sizes.standard),
      'Standard build — balanced output, suitable for most uses',
    ],
    [
      '`min.extension.js`',
      formatBytes(sizes.min),
      'Minified build — smallest size, best for production deployment',
    ],
    [
      '`pretty.extension.js`',
      formatBytes(sizes.pretty),
      'Formatted build — human-readable, best for debugging',
    ],
  ];

  const colWidths = rows.reduce(
    (acc, row) => row.map((cell, i) => Math.max(acc[i], cell.length)),
    ['File'.length, 'Size'.length, 'Description'.length]
  );

  const pad = (str, width) => str + ' '.repeat(width - str.length);
  const separator = colWidths.map(w => '-'.repeat(w)).join(' | ');
  const header = colWidths.map((w, i) => pad(['File', 'Size', 'Description'][i], w)).join(' | ');
  const tableRows = rows.map(row => row.map((cell, i) => pad(cell, colWidths[i])).join(' | '));

  const table = [`| ${header} |`, `| ${separator} |`, ...tableRows.map(r => `| ${r} |`)].join('\n');

  const report = [
    '# Build Report',
    '',
    `Generated: ${new Date().toUTCString()}`,
    '',
    '## Output Artifacts',
    '',
    table,
    '',
    '## Recommendations',
    '',
    `**Production use:** ${recommendProd}`,
    standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && minAvailable
      ? `> Bundle size is ${formatBytes(standardBytes)}, which exceeds the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. Use the minified output to reduce load time.`
      : standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && !minAvailable
        ? `> Bundle size is ${formatBytes(standardBytes)}, which exceeds the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. Install \`terser\` to enable minified output.`
        : `> Bundle size is ${formatBytes(standardBytes)}, which is below the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. The standard output is suitable for production.`,
    '',
    `**Debugging:** \`pretty.extension.js\``,
    prettyAvailable
      ? '> The formatted output preserves whitespace and structure, making it easy to read and inspect.'
      : '> Install `prettier` to enable the formatted output for debugging.',
    '',
    '## How to Choose',
    '',
    '| Scenario | Recommended file |',
    '| --- | --- |',
    '| Deploying / sharing the extension | ' + recommendProd + ' |',
    '| Debugging or reading the source | `pretty.extension.js`' +
      (!prettyAvailable ? ' _(install `prettier` to generate)_' : '') +
      ' |',
    '| General development iteration | `extension.js` |',
    '',
    '---',
    '',
    '_This report is auto-generated by Mint on every successful build. Do not edit manually._',
  ].join('\n');

  try {
    fs.writeFileSync(OUTPUT_REPORT_FILE, report, 'utf8');
    console.log(`  Build report written to ${OUTPUT_REPORT_FILE}`);
  } catch (err) {
    console.warn(`Warning: Could not write build report to ${OUTPUT_REPORT_FILE}: ${err.message}`);
  }
}

/**
 * Build the extension by concatenating, cleaning, minifying, and maximizing JS files
 */
async function buildExtension() {
  try {
    const manifest = getManifest();
    const header = generateHeader(manifest);
    const sourceFiles = getSourceFiles();

    // Validate opcode-to-method signatures before emitting any artifacts
    const validationErrors = validateOpcodeSignatures();
    if (validationErrors.length > 0) {
      console.error('✗ Opcode validation failed:');
      for (const err of validationErrors) {
        console.error(err);
      }
      return false;
    }
    console.log('✓ Opcode signatures valid');

    // Validate asset references before bundling
    const { errors: assetErrors, warnings: assetWarnings } = validateAssetReferences(SRC_DIR);
    for (const w of assetWarnings) {
      console.warn(w);
    }
    if (assetErrors.length > 0) {
      console.error('✗ Asset reference validation failed:');
      for (const err of assetErrors) {
        console.error(err);
      }
      return false;
    }
    console.log('✓ Asset references valid');

    // --- Bundle assets from src/assets as base64 data URIs ---
    let assetsCode = '';
    let assetsMap = {};
    try {
      const assetsDir = path.join(SRC_DIR, 'assets');
      if (fs.existsSync(assetsDir)) {
        const walk = dir =>
          fs
            .readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .flatMap(d => {
              const res = path.join(dir, d.name);
              return d.isDirectory() ? walk(res) : [res];
            });
        const assetFiles = walk(assetsDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (assetFiles.length) {
          const assets = {};
          assetFiles.forEach(f => {
            const rel = path.relative(assetsDir, f).replace(/\\/g, '/');
            const ext = path.extname(f).toLowerCase();
            const mime = MIME_MAP[ext] || 'application/octet-stream';
            const data = fs.readFileSync(f);
            const b64 = data.toString('base64');
            assets[rel] = `data:${mime};base64,${b64}`;
          });

          // Generate JS code that defines functions for each asset and a getter
          const makeSafe = name =>
            name.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[0-9]/, m => '_' + m);
          let gen = '  // --- Embedded assets ---\n';
          Object.keys(assets)
            .sort()
            .forEach((key, idx, arr) => {
              const fn = '__mint_asset_' + makeSafe(key) + '_' + idx;
              gen += `  function ${fn}() { return ${JSON.stringify(assets[key])}; }\n`;
            });
          gen += '\n  const __mint_assets = {\n';
          Object.keys(assets)
            .sort()
            .forEach((key, idx, arr) => {
              const fn = '__mint_asset_' + makeSafe(key) + '_' + idx;
              gen += `    ${JSON.stringify(key)}: ${fn}${idx < arr.length - 1 ? ',' : ''}\n`;
            });
          gen += '  };\n\n';
          gen +=
            '  function __mint_getAsset(name) { return __mint_assets[name] ? __mint_assets[name]() : undefined; }\n\n';
          assetsCode = gen;

          // Also expose the assets map for build-time replacements
          assetsMap = assets;
        }
      }
    } catch (err) {
      console.warn('Asset bundling failed:', err && err.message ? err.message : err);
      assetsCode = '';
    }

    let output = header;

    // Add IIFE wrapper that takes Scratch as parameter
    output += '(function (Scratch) {\n';
    output += '  "use strict";\n\n';
    output += assetsCode || '';

    // Concatenate all source files
    sourceFiles.forEach(file => {
      const filename = path.basename(file);
      output += `  // ===== ${filename} =====\n`;

      let content = fs.readFileSync(file, 'utf8');

      /**
       * TRANSFORM MODULES TO PLAIN JS
       */
      // 1. Remove import lines
      content = content.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?/gm, '');

      // 2. Remove 'export ' prefix
      content = content.replace(/^export\s+/gm, '');

      // 3. Replace only explicit __ASSET__('path') placeholders with literal data URIs
      if (assetsMap && Object.keys(assetsMap).length) {
        content = content.replace(/__ASSET__\(\s*(['"])([^'\"]+)\1\s*\)/g, (m, q, key) => {
          // Normalise lookup key to use POSIX-style separators and remove redundant segments
          const lookupKey = path.posix.normalize(key.replace(/\\/g, '/'));
          const val = assetsMap[lookupKey];
          if (val && typeof val === 'string') {
            return JSON.stringify(val);
          }
          // Fail fast on unresolved asset references so build aborts
          throw new Error(`Missing asset key: ${key}`);
        });
      }

      // Indent the content for the IIFE
      const indentedContent = content
        .split('\n')
        .map(line => {
          return line.length === 0 ? '' : '  ' + line;
        })
        .join('\n');

      output += indentedContent;
      output += '\n\n';
    });

    // Close IIFE
    output += '})(Scratch);\n';

    // Optionally strip comments in production mode (preserve the header)
    let finalOutput = output;
    if (productionMode) {
      try {
        const { minify } = await import('terser');
        // Use terser to remove comments while keeping header metadata comments
        const cleaned = await minify(output, {
          compress: false,
          mangle: false,
          format: {
            comments: /^\s*(Name|ID|Description|By|License|Version):/,
            beautify: true,
          },
        });
        if (cleaned && typeof cleaned.code === 'string') {
          finalOutput = cleaned.code;
        }
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
          console.warn('        (Skipping comment stripping: "terser" not found)');
        } else {
          console.warn('[PROD] Comment stripping failed:', err);
        }
      }
    }

    // Write standard output
    fs.writeFileSync(OUTPUT_FILE, finalOutput, 'utf8');

    const info = [];
    const size = (finalOutput.length / 1024).toFixed(2);
    info.push(`[NORMAL] Standard build successful: ${OUTPUT_FILE} (${size} KB)`);

    // Track artifact sizes for the build report (null = artifact was not generated)
    const artifactSizes = { standard: finalOutput.length, min: null, pretty: null };

    // --- Maximization Step (Prettier) ---
    try {
      const { format, resolveConfig } = await import('prettier');
      const prettierConfig = (await resolveConfig(OUTPUT_MAX_FILE)) || {};
      const formatted = await format(finalOutput, {
        ...prettierConfig,
        parser: 'babel',
      });

      fs.writeFileSync(OUTPUT_MAX_FILE, formatted, 'utf8');
      const maxSize = (formatted.length / 1024).toFixed(2);
      info.push(`Maximized output created: ${OUTPUT_MAX_FILE} (${maxSize} KB)`);
      artifactSizes.pretty = formatted.length;
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.warn('        (Skipping maximization: "prettier" not found)');
      } else {
        console.warn('✗ Maximization failed:', err);
      }
    }

    // --- Minification Step (Terser) ---
    try {
      const { minify } = await import('terser');
      const minified = await minify(finalOutput, {
        compress: true,
        mangle: true,
        format: {
          comments: /^\s*(Name|ID|Description|By|License|Version):/,
        },
      });

      if (minified && minified.code) {
        fs.writeFileSync(OUTPUT_MIN_FILE, minified.code, 'utf8');
        const minSize = (minified.code.length / 1024).toFixed(2);
        info.push(`Minified output created: ${OUTPUT_MIN_FILE} (${minSize} KB)`);
        artifactSizes.min = minified.code.length;
      } else {
        console.warn('✗ Minification produced no code');
      }
    } catch (err) {
      if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
        console.warn('        (Skipping minification: "terser" not found)');
      } else {
        console.warn('✗ Minification failed:', err);
      }
    }

    // --- Build Report ---
    generateBuildReport(artifactSizes);

    console.log('✓ Build successful');
    if (lastBuildFailed) {
      printRecoveryBanner();
      sendNotification('Mint Build', 'Build recovered — errors resolved.');
    }
    lastBuildFailed = false;
    return true;
  } catch (err) {
    printFailureBanner(err.message);
    sendNotification('Mint Build Failed', err.message);
    lastBuildFailed = true;
    return false;
  }
}

/**
 * Coalescing guard to prevent concurrent build runs
 */
async function guardedBuild() {
  if (isBuilding) {
    pendingBuild = true;
    return;
  }

  isBuilding = true;
  await buildExtension();
  isBuilding = false;

  if (pendingBuild) {
    pendingBuild = false;
    // Trigger the next build in the next tick
    setImmediate(guardedBuild);
  }
}

/**
 * Watch for file changes
 */
async function watchFiles() {
  let chokidar;
  try {
    chokidar = (await import('chokidar')).default;
  } catch (_err) {
    console.error('Watch mode requires chokidar. Install it with: npm install --save-dev chokidar');
    process.exit(1);
  }

  console.log('Watching for changes in', SRC_DIR);

  const watcher = chokidar.watch(SRC_DIR, {
    // eslint-disable-next-line no-useless-escape
    ignored: /(^|[\/\\])\./,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  watcher.on('all', (event, file) => {
    console.log(`[WATCH] ${event}: ${path.basename(file)}`);
    guardedBuild();
  });
}

// Execute
(async () => {
  // Always run the initial build
  const success = await buildExtension();

  if (!success && !watchMode) {
    process.exit(1);
  }

  if (watchMode) {
    watchFiles();
  }
})();
