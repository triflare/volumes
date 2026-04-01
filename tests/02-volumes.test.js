/**
 * Unit tests for src/02-volumes.js
 *
 * Exercises each exported helper function directly using an in-memory OPFS
 * mock.  No Scratch runtime is required.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockOpfs } from './helpers/mock-opfs.js';
import {
  writeFileImpl,
  readFileImpl,
  deleteFileImpl,
  fileExistsImpl,
  listFilesImpl,
  makeDirImpl,
  deleteDirImpl,
} from '../src/02-volumes.js';

// Install a single shared in-memory OPFS root for all tests in this file.
// Each test uses unique path names to avoid inter-test state pollution.
const { install } = createMockOpfs();
const restore = install();
after(restore);

// ---------------------------------------------------------------------------
// writeFileImpl / readFileImpl
// ---------------------------------------------------------------------------

describe('writeFileImpl() / readFileImpl()', () => {
  it('writes and reads back a simple string', async () => {
    await writeFileImpl({ PATH: 'hello.txt', CONTENT: 'Hello, OPFS!' });
    assert.equal(await readFileImpl({ PATH: 'hello.txt' }), 'Hello, OPFS!');
  });

  it('overwrites an existing file', async () => {
    await writeFileImpl({ PATH: 'overwrite.txt', CONTENT: 'first' });
    await writeFileImpl({ PATH: 'overwrite.txt', CONTENT: 'second' });
    assert.equal(await readFileImpl({ PATH: 'overwrite.txt' }), 'second');
  });

  it('creates intermediate directories automatically', async () => {
    await writeFileImpl({ PATH: 'a/b/nested.txt', CONTENT: 'deep' });
    assert.equal(await readFileImpl({ PATH: 'a/b/nested.txt' }), 'deep');
  });

  it('coerces non-string CONTENT to string', async () => {
    await writeFileImpl({ PATH: 'num.txt', CONTENT: 42 });
    assert.equal(await readFileImpl({ PATH: 'num.txt' }), '42');
  });

  it('readFileImpl returns empty string for a missing file', async () => {
    assert.equal(await readFileImpl({ PATH: 'does-not-exist.txt' }), '');
  });
});

// ---------------------------------------------------------------------------
// fileExistsImpl
// ---------------------------------------------------------------------------

describe('fileExistsImpl()', () => {
  it('returns true for an existing file', async () => {
    await writeFileImpl({ PATH: 'exists.txt', CONTENT: 'yes' });
    assert.equal(await fileExistsImpl({ PATH: 'exists.txt' }), true);
  });

  it('returns false for a non-existing file', async () => {
    assert.equal(await fileExistsImpl({ PATH: 'ghost.txt' }), false);
  });
});

// ---------------------------------------------------------------------------
// deleteFileImpl
// ---------------------------------------------------------------------------

describe('deleteFileImpl()', () => {
  it('removes the file so readFileImpl returns empty string', async () => {
    await writeFileImpl({ PATH: 'todelete.txt', CONTENT: 'bye' });
    await deleteFileImpl({ PATH: 'todelete.txt' });
    assert.equal(await readFileImpl({ PATH: 'todelete.txt' }), '');
  });

  it('does not throw when the file does not exist', async () => {
    await assert.doesNotReject(() => deleteFileImpl({ PATH: 'never-existed.txt' }));
  });
});

// ---------------------------------------------------------------------------
// makeDirImpl / listFilesImpl
// ---------------------------------------------------------------------------

describe('makeDirImpl() / listFilesImpl()', () => {
  it('creates a directory that appears in the root listing', async () => {
    await makeDirImpl({ DIR: 'mydir' });
    const list = JSON.parse(await listFilesImpl({ DIR: '/' }));
    assert.ok(list.includes('mydir'), 'mydir should appear in root listing');
  });

  it('creates nested directories', async () => {
    await makeDirImpl({ DIR: 'parent/child' });
    const list = JSON.parse(await listFilesImpl({ DIR: 'parent' }));
    assert.ok(list.includes('child'), 'child should appear in parent listing');
  });

  it('listFilesImpl returns sorted entry names', async () => {
    await makeDirImpl({ DIR: 'sorttest' });
    await writeFileImpl({ PATH: 'sorttest/z.txt', CONTENT: '' });
    await writeFileImpl({ PATH: 'sorttest/a.txt', CONTENT: '' });
    await writeFileImpl({ PATH: 'sorttest/m.txt', CONTENT: '' });
    const list = JSON.parse(await listFilesImpl({ DIR: 'sorttest' }));
    assert.deepEqual(list, ['a.txt', 'm.txt', 'z.txt']);
  });

  it('listFilesImpl returns "[]" for a non-existing directory', async () => {
    assert.equal(await listFilesImpl({ DIR: 'no-such-dir' }), '[]');
  });

  it('listFilesImpl accepts "/" as the root', async () => {
    await makeDirImpl({ DIR: 'rootdir' });
    const list = JSON.parse(await listFilesImpl({ DIR: '/' }));
    assert.ok(Array.isArray(list));
    assert.ok(list.includes('rootdir'));
  });
});

// ---------------------------------------------------------------------------
// deleteDirImpl
// ---------------------------------------------------------------------------

describe('deleteDirImpl()', () => {
  it('removes a directory from the root listing', async () => {
    await makeDirImpl({ DIR: 'rmdir' });
    await deleteDirImpl({ DIR: 'rmdir' });
    const list = JSON.parse(await listFilesImpl({ DIR: '/' }));
    assert.ok(!list.includes('rmdir'), 'deleted directory should not appear in listing');
  });

  it('does not throw when the directory does not exist', async () => {
    await assert.doesNotReject(() => deleteDirImpl({ DIR: 'never-existed-dir' }));
  });
});
