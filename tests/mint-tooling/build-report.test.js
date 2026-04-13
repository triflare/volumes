import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === '.mint-cache'
    )
      continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runBuild(cwd, args = []) {
  return spawnSync(process.execPath, ['scripts/build.js', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('enhanced build report', () => {
  it('includes Summary, Module Breakdown, and Optimization Suggestions sections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-report-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      try {
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      } catch (_err) {
        try {
          fs.symlinkSync(
            path.join(REPO_ROOT, 'node_modules'),
            path.join(tempDir, 'node_modules'),
            'junction'
          );
        } catch (err2) {
          console.warn(
            'Skipping test: could not create node_modules symlink/junction -',
            err2 && err2.message ? err2.message : err2
          );
          return;
        }
      }

      const result = runBuild(tempDir);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const report = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');

      assert.ok(report.includes('## Summary'), 'report should include a Summary section');
      assert.ok(report.includes('**Total size:**'), 'Summary should include total size');
      assert.ok(report.includes('**Modules:**'), 'Summary should include module count');

      assert.ok(
        report.includes('## Module Breakdown'),
        'report should include Module Breakdown section'
      );
      assert.ok(
        report.includes('Bundle size'),
        'Module Breakdown table should have Bundle size column'
      );
      assert.ok(
        report.includes('% of modules'),
        'Module Breakdown table should have % of modules column'
      );

      assert.ok(
        report.includes('## Optimization Suggestions'),
        'report should include Optimization Suggestions section'
      );

      // Existing sections should still be present
      assert.ok(
        report.includes('## Output Artifacts'),
        'report should include Output Artifacts section'
      );
      assert.ok(
        report.includes('## Recommendations'),
        'report should include Recommendations section'
      );
      assert.ok(report.includes('## Source Maps'), 'report should include Source Maps section');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('includes Embedded Assets section when assets are present', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-report-assets-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      try {
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      } catch (_err) {
        try {
          fs.symlinkSync(
            path.join(REPO_ROOT, 'node_modules'),
            path.join(tempDir, 'node_modules'),
            'junction'
          );
        } catch (err2) {
          console.warn(
            'Skipping test: could not create node_modules symlink/junction -',
            err2 && err2.message ? err2.message : err2
          );
          return;
        }
      }

      const result = runBuild(tempDir);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const report = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');

      // The repository includes embedded assets under src/assets/, so the report
      // should list a MIME type for at least one asset.
      assert.ok(
        report.includes('## Embedded Assets'),
        'report should include Embedded Assets section when assets are present'
      );
      assert.ok(/image\/[a-z+]+/.test(report), 'Embedded Assets table should list MIME types');
      assert.ok(
        report.includes('**Embedded assets:**'),
        'Summary should include embedded asset count'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('shows Size Trend on second build with cache', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-report-trend-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      try {
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      } catch (_err) {
        try {
          fs.symlinkSync(
            path.join(REPO_ROOT, 'node_modules'),
            path.join(tempDir, 'node_modules'),
            'junction'
          );
        } catch (err2) {
          console.warn(
            'Skipping test: could not create node_modules symlink/junction -',
            err2 && err2.message ? err2.message : err2
          );
          return;
        }
      }

      // First build — no previous size yet
      const first = runBuild(tempDir);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const reportFirst = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');
      assert.ok(
        !reportFirst.includes('## Size Trend'),
        'Size Trend should not appear on the first build'
      );

      // Second build — previous size stored in cache
      const second = runBuild(tempDir);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      const reportSecond = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');
      assert.ok(
        reportSecond.includes('## Size Trend'),
        'Size Trend should appear on the second build'
      );
      assert.ok(reportSecond.includes('Previous:'), 'Size Trend should show previous build size');
      assert.ok(reportSecond.includes('Current:'), 'Size Trend should show current build size');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('omits Size Trend on first build or when cache is cleared', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-report-nocache-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      try {
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      } catch (_err) {
        try {
          fs.symlinkSync(
            path.join(REPO_ROOT, 'node_modules'),
            path.join(tempDir, 'node_modules'),
            'junction'
          );
        } catch (err2) {
          console.warn(
            'Skipping test: could not create node_modules symlink/junction -',
            err2 && err2.message ? err2.message : err2
          );
          return;
        }
      }

      // Two builds with --no-cache — should never show size trend
      const first = runBuild(tempDir, ['--no-cache']);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const second = runBuild(tempDir, ['--no-cache']);
      assert.equal(second.status, 0, second.stderr || second.stdout);

      const report = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');
      assert.ok(
        report.includes('## Output Artifacts'),
        'Build report should still be generated in no-cache mode'
      );
      assert.ok(
        !report.includes('## Size Trend'),
        'Size Trend should not appear when cache is disabled'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('module breakdown bar chart appears in report', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-report-chart-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      try {
        fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      } catch (_err) {
        try {
          fs.symlinkSync(
            path.join(REPO_ROOT, 'node_modules'),
            path.join(tempDir, 'node_modules'),
            'junction'
          );
        } catch (err2) {
          console.warn(
            'Skipping test: could not create node_modules symlink/junction -',
            err2 && err2.message ? err2.message : err2
          );
          return;
        }
      }

      const result = runBuild(tempDir);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const report = fs.readFileSync(path.join(tempDir, 'build', 'BUILD_REPORT.md'), 'utf8');

      // The bar chart uses block characters inside a code fence
      assert.ok(report.includes('█'), 'report should include ASCII bar chart blocks');
      assert.ok(report.includes('```'), 'report should include code fence for bar chart');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
