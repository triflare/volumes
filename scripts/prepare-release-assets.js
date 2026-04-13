#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function main() {
  const manifestPath = path.join(process.cwd(), 'src', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('src/manifest.json not found');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const baseName =
    String(manifest.id ?? manifest.name ?? 'extension')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'extension';
  const version = String(manifest.version ?? '')
    .trim()
    .replace(/^v/, '');
  if (!version) {
    console.error('src/manifest.json version is missing or empty.');
    process.exit(1);
  }
  const outDir = path.join('build', 'release');
  fs.mkdirSync(outDir, { recursive: true });
  const outputs = {
    pretty: `${baseName}@${version}.js`,
    min: `min.${baseName}@${version}.js`,
    sourcemap: `sourcemap.${baseName}@${version}.js.map`,
  };

  const sourceFiles = [
    path.join('build', 'pretty.extension.js'),
    path.join('build', 'min.extension.js'),
    path.join('build', 'extension.js.map'),
  ];
  for (const src of sourceFiles) {
    if (!fs.existsSync(src)) {
      console.error(`Source file not found: ${src}`);
      process.exit(1);
    }
  }

  fs.copyFileSync(path.join('build', 'pretty.extension.js'), path.join(outDir, outputs.pretty));
  fs.copyFileSync(path.join('build', 'min.extension.js'), path.join(outDir, outputs.min));
  fs.copyFileSync(path.join('build', 'extension.js.map'), path.join(outDir, outputs.sourcemap));

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `pretty=build/release/${outputs.pretty}\n`);
    fs.appendFileSync(outputFile, `min=build/release/${outputs.min}\n`);
    fs.appendFileSync(outputFile, `sourcemap=build/release/${outputs.sourcemap}\n`);
  } else {
    // Not running in Actions; print outputs for visibility
    console.log(`pretty=build/release/${outputs.pretty}`);
    console.log(`min=build/release/${outputs.min}`);
    console.log(`sourcemap=build/release/${outputs.sourcemap}`);
  }
}

try {
  main();
} catch (err) {
  console.error('Error preparing release assets:', err && err.stack ? err.stack : err);
  process.exit(1);
}
