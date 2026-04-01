/**
 * Unit tests for src/01-core.js (VolumesExtension class)
 *
 * The Scratch global mock and the OPFS mock must both be installed before the
 * core module is imported, because 01-core.js calls Scratch.extensions.register()
 * at module load time.  The Scratch mock captures the registered instance so
 * that class methods can be exercised directly.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';
import { createMockOpfs } from './helpers/mock-opfs.js';

// Install the Scratch mock and capture the registered extension instance.
const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

// Install the in-memory OPFS mock so navigator.storage is available.
const { install } = createMockOpfs();
const restore = install();
after(restore);

// Top-level await: load the core module so registration fires.
await import('../src/01-core.js');

describe('VolumesExtension — registration', () => {
  it('registers an extension instance with Scratch', () => {
    assert.ok(extension, 'Scratch.extensions.register should have been called');
  });
});

describe('VolumesExtension — getInfo()', () => {
  it('returns id "volumes"', () => {
    assert.equal(extension.getInfo().id, 'volumes');
  });

  it('returns a name string', () => {
    assert.equal(typeof extension.getInfo().name, 'string');
  });

  it('exposes a non-empty blocks array', () => {
    const { blocks } = extension.getInfo();
    assert.ok(Array.isArray(blocks) && blocks.length > 0, 'blocks should be a non-empty array');
  });

  it('declares all expected block opcodes', () => {
    const opcodes = extension.getInfo().blocks.map(b => b.opcode);
    for (const op of [
      'writeFile',
      'readFile',
      'deleteFile',
      'fileExists',
      'listFiles',
      'makeDir',
      'deleteDir',
    ]) {
      assert.ok(opcodes.includes(op), `missing opcode: ${op}`);
    }
  });
});

describe('VolumesExtension — writeFile() / readFile()', () => {
  it('writes content and reads it back', async () => {
    await extension.writeFile({ PATH: 'core-rw.txt', CONTENT: 'hello world' });
    assert.equal(await extension.readFile({ PATH: 'core-rw.txt' }), 'hello world');
  });

  it('readFile returns empty string for a missing file', async () => {
    assert.equal(await extension.readFile({ PATH: 'no-such-file.txt' }), '');
  });
});

describe('VolumesExtension — fileExists()', () => {
  it('returns true for an existing file', async () => {
    await extension.writeFile({ PATH: 'core-exists.txt', CONTENT: 'yes' });
    assert.equal(await extension.fileExists({ PATH: 'core-exists.txt' }), true);
  });

  it('returns false for a non-existing file', async () => {
    assert.equal(await extension.fileExists({ PATH: 'core-ghost.txt' }), false);
  });
});

describe('VolumesExtension — deleteFile()', () => {
  it('removes the file so it can no longer be read', async () => {
    await extension.writeFile({ PATH: 'core-del.txt', CONTENT: 'bye' });
    await extension.deleteFile({ PATH: 'core-del.txt' });
    assert.equal(await extension.readFile({ PATH: 'core-del.txt' }), '');
  });
});

describe('VolumesExtension — makeDir() / listFiles()', () => {
  it('creates a directory visible in the root listing', async () => {
    await extension.makeDir({ DIR: 'core-mydir' });
    const list = JSON.parse(await extension.listFiles({ DIR: '/' }));
    assert.ok(list.includes('core-mydir'), 'created directory should appear in listing');
  });
});

describe('VolumesExtension — deleteDir()', () => {
  it('removes a directory from the root listing', async () => {
    await extension.makeDir({ DIR: 'core-rmdir' });
    await extension.deleteDir({ DIR: 'core-rmdir' });
    const list = JSON.parse(await extension.listFiles({ DIR: '/' }));
    assert.ok(!list.includes('core-rmdir'), 'deleted directory should not appear in listing');
  });
});
