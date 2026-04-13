/**
 * Comprehensive unit tests for src/01-core.js.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

let extension;
let opfsRoot;
let originalNavigatorDescriptor;

const nativeAtob = typeof globalThis.atob === 'function' ? globalThis.atob : null;
const nativeBtoa = typeof globalThis.btoa === 'function' ? globalThis.btoa : null;

function ensureBase64Globals() {
  if (typeof globalThis.atob !== 'function') {
    globalThis.atob = str => Buffer.from(str, 'base64').toString('binary');
  }
  if (typeof globalThis.btoa !== 'function') {
    globalThis.btoa = str => Buffer.from(str, 'binary').toString('base64');
  }
}

function restoreBase64Globals() {
  if (nativeAtob) {
    globalThis.atob = nativeAtob;
  } else {
    delete globalThis.atob;
  }
  if (nativeBtoa) {
    globalThis.btoa = nativeBtoa;
  } else {
    delete globalThis.btoa;
  }
}

class MockOPFSFile {
  constructor(name) {
    this.name = name;
    this.content = new Uint8Array(0);
    this.type = '';
  }

  createWritable(_options = {}) {
    let buffer = this.content;
    return {
      write: data => {
        if (data && typeof data === 'object' && data.type === 'write') {
          const position = Number(data.position || 0);
          const chunk = data.data;
          const newBuffer = new Uint8Array(position + chunk.byteLength);
          newBuffer.set(buffer.subarray(0, position), 0);
          newBuffer.set(chunk, position);
          buffer = newBuffer;
          return;
        }

        if (data instanceof Uint8Array) {
          buffer = data;
        } else if (typeof data === 'string') {
          buffer = new TextEncoder().encode(data);
        } else {
          buffer = new Uint8Array(0);
        }
      },
      close: () => {
        this.content = buffer;
      },
    };
  }

  getFile() {
    const bytes = new Uint8Array(this.content);
    return {
      size: bytes.byteLength,
      arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      text() {
        return new TextDecoder().decode(bytes);
      },
      type: this.type,
    };
  }
}

class MockOPFSDirectory {
  constructor(name) {
    this.name = name;
    this.entries = new Map();
  }

  getDirectoryHandle(name, options = {}) {
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind === 'directory') return existing.handle;
      const err = new Error('TypeMismatchError');
      err.name = 'TypeMismatchError';
      throw err;
    }

    if (!options.create) {
      const err = new Error('NotFoundError');
      err.name = 'NotFoundError';
      throw err;
    }

    const handle = new MockOPFSDirectory(name);
    this.entries.set(name, { kind: 'directory', handle });
    return handle;
  }

  getFileHandle(name, options = {}) {
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind === 'file') return existing.handle;
      const err = new Error('TypeMismatchError');
      err.name = 'TypeMismatchError';
      throw err;
    }

    if (!options.create) {
      const err = new Error('NotFoundError');
      err.name = 'NotFoundError';
      throw err;
    }

    const handle = new MockOPFSFile(name);
    this.entries.set(name, { kind: 'file', handle });
    return handle;
  }

  removeEntry(name, options = {}) {
    const existing = this.entries.get(name);
    if (!existing) {
      const err = new Error('NotFoundError');
      err.name = 'NotFoundError';
      throw err;
    }

    if (existing.kind === 'directory' && this.entries.get(name).handle.entries.size > 0 && !options.recursive) {
      throw new Error('DIRECTORY_NOT_EMPTY');
    }

    this.entries.delete(name);
  }

  async *values() {
    for (const [name, entry] of this.entries) {
      yield { name, kind: entry.kind, handle: entry.handle };
    }
  }

  async *entries() {
    for (const [name, entry] of this.entries) {
      yield [name, entry.handle];
    }
  }
}

function assertSuccess(result) {
  const parsed = JSON.parse(result);
  assert.equal(parsed.status, 'success', `Expected success but got ${result}`);
  return parsed;
}

function _assertFailure(result, expectedCode) {
  const parsed = JSON.parse(result);
  assert.equal(parsed.status, 'error', `Expected error but got ${result}`);
  if (expectedCode) assert.equal(parsed.code, expectedCode);
  return parsed;
}

before(async () => {
  ensureBase64Globals();
  const { mock } = installScratchMock();
  mock.extensions.register = instance => {
    extension = instance;
  };

  opfsRoot = new MockOPFSDirectory('root');
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      storage: {
        getDirectory: () => opfsRoot,
      },
    },
    configurable: true,
    enumerable: true,
  });

  await import('../src/01-core.js');
  assert.ok(extension, 'The extension should register with Scratch on import');
});

describe('tfVolumes extension', () => {
  it('registers with Scratch and exposes a tfVolumes instance', () => {
    assert.ok(extension instanceof Object);
    assert.equal(extension.getInfo().id, 'tfVolumes');
  });

  it('builds a valid getInfo block list and hides advanced blocks by default', () => {
    const info = extension.getInfo();
    assert.equal(info.name, 'Volumes');
    assert.ok(Array.isArray(info.blocks));
    assert.ok(info.blocks.some(block => block.opcode === 'mountAs'));
    assert.ok(info.blocks.some(block => block.opcode === 'mountArchive'));
    const advancedLabel = info.blocks.find(block => block.blockType === 'label' && block.text === 'Management');
    assert.ok(advancedLabel);
    assert.equal(advancedLabel.hideFromPalette, true);
  });

  it('toggles advanced block visibility', () => {
    extension.toggleAdvancedBlocks();
    const info = extension.getInfo();
    const advancedLabel = info.blocks.find(block => block.blockType === 'label' && block.text === 'Management');
    assert.equal(advancedLabel.hideFromPalette, false);
  });

  it('joins paths correctly for both protocol-qualified and plain segments', () => {
    assert.equal(extension.joinPaths({ P1: 'tmp://foo', P2: 'bar.txt' }), 'tmp://foo/bar.txt');
    assert.equal(extension.joinPaths({ P1: 'tmp://foo/', P2: '/bar.txt' }), 'tmp://foo/bar.txt');
    assert.equal(extension.joinPaths({ P1: 'tmp://', P2: 'file.txt' }), 'tmp://file.txt');
  });
});

describe('RAM volume operations', () => {
  it('mounts, writes, reads and deletes files on a RAM volume', async () => {
    const testVol = `test-ram-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: testVol, TYPE: 'RAM' }));
    assert.equal(JSON.parse(await extension.listVolumes()).includes(testVol), true);

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'hello', PATH: `${testVol}hello.txt` }));
    assert.equal(await extension.fileRead({ PATH: `${testVol}hello.txt`, FORMAT: 'text' }), 'hello');

    assertSuccess(await extension.fileWrite({ MODE: 'append', STRING: ' world', PATH: `${testVol}hello.txt` }));
    assert.equal(await extension.fileRead({ PATH: `${testVol}hello.txt`, FORMAT: 'text' }), 'hello world');

    assert.equal(await extension.pathCheck({ PATH: `${testVol}hello.txt`, CONDITION: 'exists' }), true);
    assert.equal(await extension.pathCheck({ PATH: `${testVol}hello.txt`, CONDITION: 'is a directory' }), false);

    assertSuccess(await extension.deletePath({ PATH: `${testVol}hello.txt` }));
    assert.equal(await extension.pathCheck({ PATH: `${testVol}hello.txt`, CONDITION: 'exists' }), false);
  });

  it('creates nested directories, lists files recursively, and handles type mismatches', async () => {
    const testVol = `test-ram-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    await extension.mountAs({ VOL: testVol, TYPE: 'RAM' });
    const nestedFile = `${testVol}dir/sub/file.txt`;
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'nested', PATH: nestedFile }));

    const immediate = JSON.parse(await extension.listFiles({ DEPTH: 'immediate', PATH: `${testVol}dir` }));
    assert.deepEqual(immediate.sort(), ['sub']);

    const recursive = JSON.parse(await extension.listFiles({ DEPTH: 'all', PATH: `${testVol}dir` }));
    assert.deepEqual(recursive.sort(), ['sub', 'sub/file.txt']);

    assert.equal(await extension.pathCheck({ PATH: `${testVol}dir`, CONDITION: 'is a directory' }), true);
    assert.equal(await extension.pathCheck({ PATH: `${testVol}dir/sub/file.txt`, CONDITION: 'exists' }), true);
  });

  it('supports data URI writes and returns correct text content', async () => {
    const testVol = `test-ram-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: testVol, TYPE: 'RAM' }));
    const dataUri = 'data:text/plain;base64,' + btoa('data-test');
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: dataUri, PATH: `${testVol}datatest.txt` }));
    assert.equal(await extension.fileRead({ PATH: `${testVol}datatest.txt`, FORMAT: 'text' }), 'data-test');
  });

  it('enforces file count and size limits', async () => {
    const testVol = `test-ram-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: testVol, TYPE: 'RAM' }));
    assertSuccess(await extension.setFileCountLimit({ VOL: testVol, LIMIT: 2 }));
    assertSuccess(await extension.setSizeLimit({ VOL: testVol, LIMIT: 1024 }));

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: `${testVol}limit1.txt` }));
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: `${testVol}limit2.txt` }));

    const limitError = JSON.parse(await extension.fileWrite({ MODE: 'write', STRING: 'c', PATH: `${testVol}limit3.txt` }));
    assert.equal(limitError.status, 'error');
    assert.equal(limitError.code, 'QUOTA_EXCEEDED');
  });

  it('supports exporting and importing a RAM volume tree', async () => {
    const testVol = `test-ram-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: testVol, TYPE: 'RAM' }));

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'extra', PATH: `${testVol}keep.txt` }));
    const exportJson = await extension.exportVolume({ VOL: testVol });
    const exported = JSON.parse(exportJson);
    assert.ok(exported[testVol]);
    assert.equal(exported[testVol].type, 'RAM');

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'temp', PATH: `${testVol}temp.txt` }));
    assertSuccess(await extension.importVolume({ VOL: testVol, JSON: exportJson }));
    assert.equal(await extension.fileRead({ PATH: `${testVol}temp.txt`, FORMAT: 'text' }), '');
    assert.equal(await extension.fileRead({ PATH: `${testVol}keep.txt`, FORMAT: 'text' }), 'extra');
  });

  it('runs a full integration integrity test successfully', async () => {
    const result = await extension.runIntegrityTest();
    assert.equal(result, 'OK');
  });
});

describe('permissions, snapshots, and transactions', () => {
  const volName = `test-perm-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;

  it('tracks permission changes and denies reads when expected', async () => {
    assertSuccess(await extension.mountAs({ VOL: volName, TYPE: 'RAM' }));
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'secret', PATH: `${volName}secret.txt` }));

    assertSuccess(await extension.setPermission({ PATH: `${volName}secret.txt`, PERM: 'read', VALUE: 'deny' }));
    assert.equal(await extension.checkPermission({ PATH: `${volName}secret.txt`, PERM: 'read' }), false);

    await extension.fileRead({ PATH: `${volName}secret.txt`, FORMAT: 'text' });
    const lastError = JSON.parse(extension.getLastError());
    assert.equal(lastError.code, 'PERMISSION_DENIED');
  });

  it('creates snapshots, restores them, and diffs snapshot states', async () => {
    const snapVol = `test-snap-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: snapVol, TYPE: 'RAM' }));
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'first', PATH: `${snapVol}file.txt` }));
    assertSuccess(await extension.createSnapshot({ VOL: snapVol, SNAP: 'one' }));

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'second', PATH: `${snapVol}file.txt` }));
    assertSuccess(await extension.createSnapshot({ VOL: snapVol, SNAP: 'two' }));

    const diff = JSON.parse(await extension.diffSnapshots({ VOL: snapVol, A: 'one', B: 'two' }));
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, ['file.txt']);

    assertSuccess(await extension.restoreSnapshot({ VOL: snapVol, SNAP: 'one' }));
    assert.equal(await extension.fileRead({ PATH: `${snapVol}file.txt`, FORMAT: 'text' }), 'first');
    assert.deepEqual(JSON.parse(await extension.listSnapshots({ VOL: snapVol })), ['one', 'two']);
  });

  it('supports transaction begin, commit, rollback, and listing', async () => {
    const txVol = `test-tx-${Date.now()}-${Math.floor(Math.random() * 10000)}://`;
    assertSuccess(await extension.mountAs({ VOL: txVol, TYPE: 'RAM' }));
    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: `${txVol}a.txt` }));

    assertSuccess(await extension.beginTransaction({ VOL: txVol, TXN: 'demo' }));
    assert.ok(JSON.parse(await extension.listTransactions()).some(tx => tx.volume === txVol));

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: `${txVol}b.txt` }));
    assertSuccess(await extension.rollbackTransaction({ VOL: txVol }));
    assert.equal(await extension.pathCheck({ PATH: `${txVol}b.txt`, CONDITION: 'exists' }), false);

    assertSuccess(await extension.beginTransaction({ VOL: txVol, TXN: 'demo2' }));
    assertSuccess(await extension.commitTransaction({ VOL: txVol }));
  });
});

describe('archive and watcher behaviors', () => {
  it('mounts a virtual archive and reads its file content', async () => {
    const archive = {
      'archive://': {
        type: 'VARCH',
        tree: {
          type: 'dir',
          children: {
            'readme.txt': {
              type: 'file',
              mime: 'text/plain',
              content: btoa('archive-content'),
              perms: {
                read: true,
                write: false,
                create: false,
                view: true,
                delete: false,
                control: false,
              },
            },
          },
        },
      },
    };

    assertSuccess(await extension.mountArchive({ VOL: 'archive://', JSON: JSON.stringify(archive) }));
    assert.equal(await extension.fileRead({ PATH: 'archive://readme.txt', FORMAT: 'text' }), 'archive-content');
  });

  it('creates a watcher and polls events for a new file write', async () => {
    const watchVol = `watch-${Date.now()}://`;
    assertSuccess(await extension.mountAs({ VOL: watchVol, TYPE: 'RAM' }));
    const watcherId = await extension.watchPath({ PATH: watchVol, DEPTH: 'immediate' });
    assert.ok(watcherId);

    assertSuccess(await extension.fileWrite({ MODE: 'write', STRING: 'watch', PATH: `${watchVol}item.txt` }));
    const events = JSON.parse(await extension.pollWatcherEvents({ WATCHER: watcherId }));
    assert.ok(events.some(event => event.relPath === 'item.txt' || event.path === `${watchVol}item.txt`));

    assertSuccess(await extension.unwatchPath({ WATCHER: watcherId }));
  });
});

after(() => {
  restoreBase64Globals();
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
});
