/**
 * Extensive unit tests for triflareVolumes extension (src/01-core.js)
 *
 * Tests cover:
 * - Volume mounting and management
 * - File I/O operations (read, write, append, delete)
 * - Path operations and validation
 * - Permission system
 * - Data URI handling
 * - Import/export functionality
 * - Error handling and edge cases
 * - Size and file count limits
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

// Install the mock and capture the registered extension instance.
const { mock, restore } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

// Mock __ASSET__ global before importing the extension
globalThis.__ASSET__ = path => `data:image/svg+xml;base64,test${path}`;

// Mock OPFS for deterministic testing
class MockOPFSFileHandle {
  constructor(name, content = new Uint8Array(0)) {
    this.kind = 'file';
    this.name = name;
    this._content = content;
  }
  async getFile() {
    return {
      size: this._content.byteLength,
      arrayBuffer: async () => this._content.buffer,
      text: async () => new TextDecoder().decode(this._content),
      type: 'application/octet-stream',
    };
  }
  async createWritable(options = {}) {
    const writable = {
      _buffer: options.keepExistingData ? this._content : new Uint8Array(0),
      write: async data => {
        if (typeof data === 'object' && data.type === 'write') {
          const newBuf = new Uint8Array(
            Math.max(writable._buffer.byteLength, data.position + data.data.byteLength)
          );
          newBuf.set(writable._buffer);
          newBuf.set(new Uint8Array(data.data), data.position);
          writable._buffer = newBuf;
        } else {
          writable._buffer = new Uint8Array(data);
        }
      },
      close: async () => {
        this._content = writable._buffer;
      },
    };
    return writable;
  }
}

class MockOPFSDirectoryHandle {
  constructor(name) {
    this.kind = 'directory';
    this.name = name;
    this._entries = new Map();
  }
  async getFileHandle(name, options = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (entry.kind === 'directory') {
        const err = new Error('TypeMismatchError');
        err.name = 'TypeMismatchError';
        throw err;
      }
      return entry;
    }
    if (options.create) {
      const fh = new MockOPFSFileHandle(name);
      this._entries.set(name, fh);
      return fh;
    }
    const err = new Error('NotFoundError');
    err.name = 'NotFoundError';
    throw err;
  }
  async getDirectoryHandle(name, options = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (entry.kind === 'file') {
        const err = new Error('TypeMismatchError');
        err.name = 'TypeMismatchError';
        throw err;
      }
      return entry;
    }
    if (options.create) {
      const dh = new MockOPFSDirectoryHandle(name);
      this._entries.set(name, dh);
      return dh;
    }
    const err = new Error('NotFoundError');
    err.name = 'NotFoundError';
    throw err;
  }
  async removeEntry(name, options = {}) {
    if (!this._entries.has(name)) {
      const err = new Error('NotFoundError');
      err.name = 'NotFoundError';
      throw err;
    }
    this._entries.delete(name);
  }
  async *values() {
    for (const entry of this._entries.values()) {
      yield entry;
    }
  }
  async *entries() {
    for (const [name, entry] of this._entries.entries()) {
      yield [name, entry];
    }
  }
  async *keys() {
    for (const name of this._entries.keys()) {
      yield name;
    }
  }
}

const opfsRoot = new MockOPFSDirectoryHandle('root');

// Mock navigator.storage for OPFS
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    writable: true,
    configurable: true,
  });
}
if (!globalThis.navigator.storage) {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {
      getDirectory: async () => opfsRoot,
    },
    writable: true,
    configurable: true,
  });
}

// Top-level await: load the core module so registration fires.
let importError;
try {
  await import('../src/01-core.js');
} catch (e) {
  importError = e;
} finally {
  if (importError) {
    restore();
    delete globalThis.__ASSET__;
    delete globalThis.navigator;
    throw importError;
  }
}

after(() => {
  restore();
  delete globalThis.__ASSET__;
  // Clean up navigator mock if we created it
  if (globalThis.navigator && globalThis.navigator.storage) {
    delete globalThis.navigator.storage;
  }
});

describe('triflareVolumes — runtime requirements', () => {
  it('alerts and throws when OPFS support is unavailable at construction time', async () => {
    const originalNavigator = globalThis.navigator;
    const originalAlert = globalThis.alert;
    let alertMessage = '';
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
    globalThis.alert = msg => {
      alertMessage = String(msg || '');
    };

    try {
      const RuntimeClass = extension.constructor;
      assert.throws(() => new RuntimeClass(), /INTERNAL_ERROR: Volumes requires OPFS support\./);
      assert.ok(alertMessage.includes('Volumes requires OPFS support'));
    } finally {
      globalThis.alert = originalAlert;
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });
});

// ===== INITIALIZATION & REGISTRATION =====

describe('triflareVolumes — initialization', () => {
  it('registers an extension instance with Scratch', () => {
    assert.ok(extension, 'Scratch.extensions.register should have been called');
    assert.equal(extension.constructor.name, 'triflareVolumes');
  });

  it('exposes a getInfo() method', () => {
    assert.equal(typeof extension.getInfo, 'function');
  });

  it('returns valid extension info', () => {
    const info = extension.getInfo();
    assert.equal(info.id, 'triflareVolumes');
    assert.equal(typeof info.name, 'string');
    assert.ok(Array.isArray(info.blocks));
    assert.ok(info.blocks.length > 0);
  });

  it('initializes with default tmp:// RAM volume', async () => {
    const volumes = JSON.parse(await extension.listVolumes());
    assert.ok(volumes.includes('tmp://'), 'default tmp:// volume should exist');
  });

  it('initializes with lastError set to success', () => {
    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'success');
  });
});

// ===== BLOCK DEFINITIONS =====

describe('triflareVolumes — block definitions', () => {
  it('declares all required block opcodes', () => {
    const info = extension.getInfo();
    const opcodes = info.blocks.map(b => b.opcode).filter(o => o);

    const required = [
      'mountAs',
      'formatVolume',
      'listVolumes',
      'setSizeLimit',
      'setFileCountLimit',
      'fileWrite',
      'fileRead',
      'deletePath',
      'listFiles',
      'pathCheck',
      'joinPaths',
      'setPermission',
      'checkPermission',
      'exportVolume',
      'importVolume',
      'getLastError',
      'runIntegrityTest',
    ];

    for (const op of required) {
      assert.ok(opcodes.includes(op), `missing opcode: ${op}`);
    }
  });

  it('includes block menus for dropdowns', () => {
    const info = extension.getInfo();
    assert.ok(info.menus, 'should have menus');
    assert.ok(info.menus.volTypes, 'should have volTypes menu');
    assert.ok(info.menus.writeMode, 'should have writeMode menu');
    assert.ok(info.menus.readFormat, 'should have readFormat menu');
    assert.ok(info.menus.pathCondition, 'should have pathCondition menu');
    assert.ok(info.menus.permissionTypes, 'should have permissionTypes menu');
  });
});

// ===== VOLUME MANAGEMENT =====

describe('triflareVolumes — volume mounting', () => {
  it('mounts a new RAM volume', async () => {
    const result = await extension.mountAs({ VOL: 'test1://', TYPE: 'RAM' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const volumes = JSON.parse(await extension.listVolumes());
    assert.ok(volumes.includes('test1://'));
  });

  it('mounts a volume with or without :// suffix', async () => {
    const result = await extension.mountAs({ VOL: 'test2', TYPE: 'RAM' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const volumes = JSON.parse(await extension.listVolumes());
    assert.ok(volumes.includes('test2://'));
  });

  it('returns formatted volume list', async () => {
    await extension.mountAs({ VOL: 'volA://', TYPE: 'RAM' });
    await extension.mountAs({ VOL: 'volB://', TYPE: 'RAM' });

    const volumesStr = await extension.listVolumes();
    const volumes = JSON.parse(volumesStr);
    assert.ok(Array.isArray(volumes));
    assert.ok(volumes.length >= 2);
  });

  it('rejects invalid volume types', async () => {
    const result = await extension.mountAs({ VOL: 'invalid://', TYPE: 'INVALID' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message);
  });

  it('initializes mounted volume with permissions', async () => {
    await extension.mountAs({ VOL: 'perms_test://', TYPE: 'RAM' });

    // Check that root has read permission
    const hasRead = await extension.checkPermission({
      PATH: 'perms_test://',
      PERM: 'read',
    });
    assert.equal(hasRead, true);
  });

  it('unmounts a volume via mountAs ACTION', async () => {
    const vol = 'unmount_test://';
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });

    // Seed internal maps to verify cleanup
    extension._opfsMeta.set(`${vol}somefile.txt`, 'text/plain');
    extension._opfsPerms.set(`${vol}somefile.txt`, { read: true });

    const res = await extension.mountAs({ ACTION: 'unmount', VOL: vol });
    const status = JSON.parse(res);
    assert.equal(status.status, 'success');

    const volumes = JSON.parse(await extension.listVolumes());
    assert.ok(!volumes.includes(vol), 'volume should be unmounted');

    for (const key of extension._opfsMeta.keys()) {
      assert.ok(!key.startsWith(vol));
    }
    for (const key of extension._opfsPerms.keys()) {
      assert.ok(!key.startsWith(vol));
    }

    const last = JSON.parse(extension.lastError);
    assert.equal(last.status, 'success');
  });

  it('delegates format via mountAs ACTION to formatVolume', async () => {
    const vol = 'format_action_test://';
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });

    let called = false;
    const originalFormat = extension.formatVolume;
    extension.formatVolume = async args => {
      called = true;
      return JSON.stringify({ status: 'success' });
    };

    const res = await extension.mountAs({ ACTION: 'format', VOL: vol, TYPE: 'RAM' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'success');
    assert.equal(called, true);

    extension.formatVolume = originalFormat;
  });
});

// ===== FILE WRITE OPERATIONS =====

describe('triflareVolumes — file write operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'write_test://', TYPE: 'RAM' });
  });

  it('writes text to a file', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'hello world',
      PATH: 'write_test://file.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('overwrites existing file', async () => {
    const vol = 'write_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'first', PATH: vol + 'overwrite.txt' });
    const content = await extension.fileRead({ PATH: vol + 'overwrite.txt', FORMAT: 'text' });
    assert.equal(content, 'first');

    await extension.fileWrite({ MODE: 'write', STRING: 'second', PATH: vol + 'overwrite.txt' });
    const updated = await extension.fileRead({ PATH: vol + 'overwrite.txt', FORMAT: 'text' });
    assert.equal(updated, 'second');
  });

  it('creates nested directories automatically', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'nested content',
      PATH: 'write_test://dir1/dir2/deep.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('rejects writing to root directory', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'test',
      PATH: 'write_test://',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message.includes('Cannot write to root'));
  });

  it('rejects invalid path format', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'test',
      PATH: 'no_protocol_file.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });

  it('handles large data', async () => {
    const largeData = 'x'.repeat(1000000); // 1MB
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: largeData,
      PATH: 'write_test://large.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('preserves file permissions when overwriting', async () => {
    const vol = 'write_test://';
    const path = vol + 'perm_file.txt';

    // Write initial file
    await extension.fileWrite({ MODE: 'write', STRING: 'content', PATH: path });

    // Deny write permission
    await extension.setPermission({ PATH: path, PERM: 'write', VALUE: 'deny' });

    // Overwrite should fail
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'new',
      PATH: path,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message.includes('Write permission denied'));
  });
});

// ===== FILE APPEND OPERATIONS =====

describe('triflareVolumes — file append operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'append_test://', TYPE: 'RAM' });
  });

  it('appends text to existing file', async () => {
    const vol = 'append_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'hello', PATH: vol + 'append.txt' });

    const result = await extension.fileWrite({
      MODE: 'append',
      STRING: ' world',
      PATH: vol + 'append.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'append.txt', FORMAT: 'text' });
    assert.equal(content, 'hello world');
  });

  it('creates file if it does not exist during append', async () => {
    const vol = 'append_test://';
    const result = await extension.fileWrite({
      MODE: 'append',
      STRING: 'new file',
      PATH: vol + 'new_append.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'new_append.txt', FORMAT: 'text' });
    assert.equal(content, 'new file');
  });

  it('appends multiple times', async () => {
    const vol = 'append_test://';
    const path = vol + 'multi.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: path });
    await extension.fileWrite({ MODE: 'append', STRING: 'b', PATH: path });
    await extension.fileWrite({ MODE: 'append', STRING: 'c', PATH: path });

    const content = await extension.fileRead({ PATH: path, FORMAT: 'text' });
    assert.equal(content, 'abc');
  });

  it('respects write permission during append', async () => {
    const vol = 'append_test://';
    const path = vol + 'perm_append.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'content', PATH: path });
    await extension.setPermission({ PATH: path, PERM: 'write', VALUE: 'deny' });

    const result = await extension.fileWrite({
      MODE: 'append',
      STRING: 'more',
      PATH: path,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });
});

// ===== FILE READ OPERATIONS =====

describe('triflareVolumes — file read operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'read_test://', TYPE: 'RAM' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'test content',
      PATH: 'read_test://sample.txt',
    });
  });

  it('reads file as text', async () => {
    const content = await extension.fileRead({
      PATH: 'read_test://sample.txt',
      FORMAT: 'text',
    });
    assert.equal(content, 'test content');
  });

  it('returns empty string on read error', async () => {
    const content = await extension.fileRead({
      PATH: 'read_test://nonexistent.txt',
      FORMAT: 'text',
    });
    assert.equal(content, '');
  });

  it('respects read permission', async () => {
    const vol = 'read_test://';
    const path = vol + 'restricted.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'secret', PATH: path });
    await extension.setPermission({ PATH: path, PERM: 'read', VALUE: 'deny' });

    const content = await extension.fileRead({ PATH: path, FORMAT: 'text' });
    assert.equal(content, '');

    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'error');
  });

  it('rejects reading directories', async () => {
    const vol = 'read_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: vol + 'dir/file.txt' });

    const content = await extension.fileRead({ PATH: vol + 'dir', FORMAT: 'text' });
    assert.equal(content, '');

    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'error');
  });
});

// ===== DATA URI OPERATIONS =====

describe('triflareVolumes — Data URI handling', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'uri_test://', TYPE: 'RAM' });
  });

  it('writes Data URI with base64 encoding', async () => {
    const base64 = btoa('hello');
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: `data:text/plain;base64,${base64}`,
      PATH: 'uri_test://data.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('reads file as Data URI with base64', async () => {
    const vol = 'uri_test://';
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'test data',
      PATH: vol + 'data_file.txt',
    });

    const dataUri = await extension.fileRead({
      PATH: vol + 'data_file.txt',
      FORMAT: 'Data URI',
    });

    assert.ok(dataUri.startsWith('data:'));
    assert.ok(dataUri.includes(';base64,'));

    // Verify the base64 decodes correctly
    const base64Part = dataUri.split(',')[1];
    const decoded = atob(base64Part);
    assert.equal(decoded, 'test data');
  });

  it('preserves MIME type in Data URI', async () => {
    const vol = 'uri_test://';
    const base64 = btoa('image data');

    await extension.fileWrite({
      MODE: 'write',
      STRING: `data:image/png;base64,${base64}`,
      PATH: vol + 'image.png',
    });

    const dataUri = await extension.fileRead({
      PATH: vol + 'image.png',
      FORMAT: 'Data URI',
    });

    assert.ok(dataUri.includes('image/png'));
  });

  it('handles URL-encoded Data URIs', async () => {
    const vol = 'uri_test://';
    const encoded = encodeURIComponent('hello world');

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: `data:text/plain,${encoded}`,
      PATH: vol + 'encoded.txt',
    });

    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'encoded.txt', FORMAT: 'text' });
    assert.equal(content, 'hello world');
  });
});

// ===== PATH OPERATIONS =====

describe('triflareVolumes — path operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'path_test://', TYPE: 'RAM' });
  });

  it('joins path segments correctly', () => {
    const result = extension.joinPaths({
      P1: 'vol://dir1',
      P2: 'file.txt',
    });
    assert.equal(result, 'vol://dir1/file.txt');
  });

  it('handles empty path segments in join', () => {
    assert.equal(extension.joinPaths({ P1: 'vol://', P2: 'file.txt' }), 'vol://file.txt');

    assert.equal(extension.joinPaths({ P1: 'vol://dir', P2: '' }), 'vol://dir');
  });

  it('normalizes trailing slashes in join', () => {
    const result = extension.joinPaths({
      P1: 'vol://dir/',
      P2: '/file.txt',
    });
    assert.equal(result, 'vol://dir/file.txt');
  });

  it('preserves protocol in join', () => {
    const result = extension.joinPaths({
      P1: 'vol://path/to/dir',
      P2: 'file.txt',
    });
    assert.ok(result.startsWith('vol://'));
  });
});

// ===== PATH EXISTENCE CHECKS =====

describe('triflareVolumes — path check operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'check_test://', TYPE: 'RAM' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'x',
      PATH: 'check_test://file.txt',
    });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'x',
      PATH: 'check_test://dir/subfile.txt',
    });
  });

  it('checks if file exists', async () => {
    const exists = await extension.pathCheck({
      PATH: 'check_test://file.txt',
      CONDITION: 'exists',
    });
    assert.equal(exists, true);
  });

  it('returns false for nonexistent path', async () => {
    const exists = await extension.pathCheck({
      PATH: 'check_test://missing.txt',
      CONDITION: 'exists',
    });
    assert.equal(exists, false);
  });

  it('checks if path is a directory', async () => {
    const isDir = await extension.pathCheck({
      PATH: 'check_test://dir',
      CONDITION: 'is a directory',
    });
    assert.equal(isDir, true);
  });

  it('returns false when file is checked as directory', async () => {
    const isDir = await extension.pathCheck({
      PATH: 'check_test://file.txt',
      CONDITION: 'is a directory',
    });
    assert.equal(isDir, false);
  });

  it('treats root as directory', async () => {
    const isDir = await extension.pathCheck({
      PATH: 'check_test://',
      CONDITION: 'is a directory',
    });
    assert.equal(isDir, true);
  });

  it('respects view permission on root', async () => {
    const vol = 'check_test://';
    await extension.setPermission({ PATH: vol, PERM: 'view', VALUE: 'deny' });

    try {
      // View permission affects listing but not existence checks
      const _exists = await extension.pathCheck({
        PATH: vol,
        CONDITION: 'exists',
      });
      assert.equal(_exists, true);

      const listResult = await extension.listFiles({
        DEPTH: 'immediate',
        PATH: vol,
      });
      assert.equal(listResult, '[]');
      const lastError = JSON.parse(extension.lastError);
      assert.equal(lastError.status, 'error');
      assert.match(lastError.message, /View permission denied/);
    } finally {
      // Reset permission
      await extension.setPermission({ PATH: vol, PERM: 'view', VALUE: 'allow' });
    }
  });
});

// ===== FILE LISTING =====

describe('triflareVolumes — file listing', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'list_test://', TYPE: 'RAM' });

    await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: 'list_test://file1.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: 'list_test://file2.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'c', PATH: 'list_test://subdir/file3.txt' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'd',
      PATH: 'list_test://subdir/nested/file4.txt',
    });
  });

  it('lists immediate files only', async () => {
    const listStr = await extension.listFiles({
      DEPTH: 'immediate',
      PATH: 'list_test://',
    });
    const files = JSON.parse(listStr);

    assert.ok(files.includes('file1.txt'));
    assert.ok(files.includes('file2.txt'));
    assert.ok(files.includes('subdir'));
    assert.equal(files.length, 3);
  });

  it('lists all files recursively', async () => {
    const listStr = await extension.listFiles({
      DEPTH: 'all',
      PATH: 'list_test://',
    });
    const files = JSON.parse(listStr);

    assert.ok(files.includes('file1.txt'));
    assert.ok(files.includes('file2.txt'));
    assert.ok(files.includes('subdir/file3.txt'));
    assert.ok(files.includes('subdir/nested/file4.txt'));
  });

  it('lists files in subdirectory', async () => {
    const listStr = await extension.listFiles({
      DEPTH: 'immediate',
      PATH: 'list_test://subdir',
    });
    const files = JSON.parse(listStr);

    assert.ok(files.includes('file3.txt'));
    assert.ok(files.includes('nested'));
  });

  it('respects view permissions in listing', async () => {
    const vol = 'list_test://';

    // Deny view on file2
    await extension.setPermission({
      PATH: vol + 'file2.txt',
      PERM: 'view',
      VALUE: 'deny',
    });

    const listStr = await extension.listFiles({
      DEPTH: 'immediate',
      PATH: vol,
    });
    const files = JSON.parse(listStr);

    assert.ok(files.includes('file1.txt'));
    assert.ok(!files.includes('file2.txt')); // Hidden due to view permission

    // Reset
    await extension.setPermission({
      PATH: vol + 'file2.txt',
      PERM: 'view',
      VALUE: 'allow',
    });
  });

  it('returns empty array for empty directory', async () => {
    await extension.mountAs({ VOL: 'empty_test://', TYPE: 'RAM' });

    const listStr = await extension.listFiles({
      DEPTH: 'immediate',
      PATH: 'empty_test://',
    });
    const files = JSON.parse(listStr);

    assert.equal(files.length, 0);
  });

  it('returns empty array on error', async () => {
    const listStr = await extension.listFiles({
      DEPTH: 'immediate',
      PATH: 'list_test://nonexistent',
    });
    const files = JSON.parse(listStr);

    assert.equal(files.length, 0);
  });
});

// ===== FILE DELETION =====

describe('triflareVolumes — file deletion', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'delete_test://', TYPE: 'RAM' });
  });

  it('deletes a file', async () => {
    const vol = 'delete_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'content', PATH: vol + 'file.txt' });

    const result = await extension.deletePath({ PATH: vol + 'file.txt' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const exists = await extension.pathCheck({ PATH: vol + 'file.txt', CONDITION: 'exists' });
    assert.equal(exists, false);
  });

  it('deletes entire directory tree recursively', async () => {
    const vol = 'delete_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: vol + 'tree/file1.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: vol + 'tree/subdir/file2.txt' });

    const result = await extension.deletePath({ PATH: vol + 'tree' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const exists = await extension.pathCheck({ PATH: vol + 'tree', CONDITION: 'exists' });
    assert.equal(exists, false);
  });

  it('returns error when deleting nonexistent path', async () => {
    const result = await extension.deletePath({
      PATH: 'delete_test://missing.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });

  it('respects delete permission', async () => {
    const vol = 'delete_test://';
    const path = vol + 'protected.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: path });
    await extension.setPermission({ PATH: path, PERM: 'delete', VALUE: 'deny' });

    const result = await extension.deletePath({ PATH: path });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');

    const still_exists = await extension.pathCheck({ PATH: path, CONDITION: 'exists' });
    assert.equal(still_exists, true);
  });

  it('rejects deleting volume root', async () => {
    const result = await extension.deletePath({ PATH: 'delete_test://' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message.includes('root'));
  });
});

// ===== PERMISSION SYSTEM =====

describe('triflareVolumes — permission management', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'perm_test://', TYPE: 'RAM' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'content',
      PATH: 'perm_test://file.txt',
    });
  });

  it('sets file permission to deny', async () => {
    const vol = 'perm_test://';
    const result = await extension.setPermission({
      PATH: vol + 'file.txt',
      PERM: 'read',
      VALUE: 'deny',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('checks permission on file', async () => {
    const vol = 'perm_test://';

    // Should have default allow permission
    const write = await extension.checkPermission({
      PATH: vol + 'file.txt',
      PERM: 'write',
    });
    assert.equal(write, true);
  });

  it('returns false after denying permission', async () => {
    const vol = 'perm_test://';
    const file = vol + 'deny_test.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: file });

    const before = await extension.checkPermission({
      PATH: file,
      PERM: 'delete',
    });
    assert.equal(before, true);

    await extension.setPermission({ PATH: file, PERM: 'delete', VALUE: 'deny' });

    const after = await extension.checkPermission({
      PATH: file,
      PERM: 'delete',
    });
    assert.equal(after, false);
  });

  it('handles all permission types', async () => {
    const vol = 'perm_test://';
    const file = vol + 'multi_perm.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: file });

    const perms = ['read', 'write', 'create', 'view', 'delete', 'control'];

    for (const perm of perms) {
      const result = await extension.setPermission({
        PATH: file,
        PERM: perm,
        VALUE: 'allow',
      });
      const status = JSON.parse(result);
      assert.equal(status.status, 'success', `failed to set ${perm}`);
    }
  });

  it('requires control permission to modify permissions', async () => {
    const vol = 'perm_test://';
    const file = vol + 'control_test.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: file });
    await extension.setPermission({ PATH: file, PERM: 'control', VALUE: 'deny' });

    const result = await extension.setPermission({
      PATH: file,
      PERM: 'read',
      VALUE: 'deny',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });

  it('checks permission on nonexistent path returns false', async () => {
    const result = await extension.checkPermission({
      PATH: 'perm_test://missing.txt',
      PERM: 'read',
    });
    assert.equal(result, false);
  });
});

// ===== SIZE AND FILE COUNT LIMITS =====

describe('triflareVolumes — size and file count limits', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'limit_test://', TYPE: 'RAM' });
  });

  it('sets size limit on volume', async () => {
    const result = await extension.setSizeLimit({
      VOL: 'limit_test://',
      LIMIT: 1000000,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('sets file count limit on volume', async () => {
    const result = await extension.setFileCountLimit({
      VOL: 'limit_test://',
      LIMIT: 100,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('rejects file write when size limit exceeded', async () => {
    const vol = 'limit_test://';

    // Set very small size limit
    await extension.setSizeLimit({ VOL: vol, LIMIT: 10 });

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'x'.repeat(100),
      PATH: vol + 'large.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message.includes('full'));
  });

  it('rejects file count when limit exceeded', async () => {
    const vol = 'limit_test://';

    // Reset limits, then set file count limit
    await extension.formatVolume({ VOL: vol });
    await extension.setFileCountLimit({ VOL: vol, LIMIT: 2 });

    // First file should succeed
    let result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'file1',
      PATH: vol + 'file1.txt',
    });
    let status = JSON.parse(result);
    assert.equal(status.status, 'success');

    // Second file should succeed
    result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'file2',
      PATH: vol + 'file2.txt',
    });
    status = JSON.parse(result);
    assert.equal(status.status, 'success');

    // Third file should fail
    result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'file3',
      PATH: vol + 'file3.txt',
    });
    status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.ok(status.message.includes('File count limit'));
  });

  it('rejects invalid limit values', async () => {
    const result = await extension.setSizeLimit({
      VOL: 'limit_test://',
      LIMIT: -100,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });
});

// ===== VOLUME FORMATTING =====

describe('triflareVolumes — volume formatting', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'format_test://', TYPE: 'RAM' });
    await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: 'format_test://file1.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: 'format_test://file2.txt' });
  });

  it('formats volume and clears all files', async () => {
    const vol = 'format_test://';

    const result = await extension.formatVolume({ VOL: vol });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const listStr = await extension.listFiles({ DEPTH: 'immediate', PATH: vol });
    const files = JSON.parse(listStr);
    assert.equal(files.length, 0);
  });

  it('resets size and file count after format', async () => {
    const vol = 'format_test://';

    await extension.fileWrite({ MODE: 'write', STRING: 'new', PATH: vol + 'after.txt' });
    await extension.formatVolume({ VOL: vol });

    // Should be able to write again without hitting size limit
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'x'.repeat(1000),
      PATH: vol + 'test.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('returns error for nonexistent volume', async () => {
    const result = await extension.formatVolume({ VOL: 'missing://' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });
});

// ===== IMPORT/EXPORT =====

describe('triflareVolumes — export/import', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'export_test://', TYPE: 'RAM' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'content1',
      PATH: 'export_test://file1.txt',
    });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'content2',
      PATH: 'export_test://dir/file2.txt',
    });
  });

  it('exports volume to JSON', async () => {
    const exported = await extension.exportVolume({ VOL: 'export_test://' });
    const data = JSON.parse(exported);

    assert.ok(data['export_test://'], 'exported volume should exist');
    assert.ok(data['export_test://'].type === 'RAM');
    assert.ok(data['export_test://'].tree);
  });

  it('exported data includes file content', async () => {
    const exported = await extension.exportVolume({ VOL: 'export_test://' });
    const data = JSON.parse(exported);
    const vol = data['export_test://'];

    // Find file1.txt in tree - it should be at root level if it exists
    assert.ok(vol.tree.children, 'tree should have children');

    // Check if file1 exists at any level
    let found = false;
    if (vol.tree.children.file1 || vol.tree.children['file1.txt']) {
      found = true;
    }

    assert.ok(found, 'file1.txt should be in exported tree');
  });

  it('imports volume from JSON', async () => {
    const vol = 'export_test://';

    // Export
    const exported = await extension.exportVolume({ VOL: vol });

    // Mount new empty volume
    await extension.mountAs({ VOL: 'import_test://', TYPE: 'RAM' });

    // Modify export for new volume name
    const data = JSON.parse(exported);
    data['import_test://'] = data['export_test://'];
    delete data['export_test://'];

    const result = await extension.importVolume({
      VOL: 'import_test://',
      JSON: JSON.stringify(data),
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    // Verify files were imported
    const file1 = await extension.fileRead({
      PATH: 'import_test://file1.txt',
      FORMAT: 'text',
    });
    assert.equal(file1, 'content1');
  });

  it('rejects invalid JSON in import', async () => {
    const result = await extension.importVolume({
      VOL: 'import_test://',
      JSON: 'not json',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });

  it('clears target volume before importing', async () => {
    const vol = 'import_test://';

    // Start fresh
    await extension.formatVolume({ VOL: vol });

    // Add some files
    await extension.fileWrite({ MODE: 'write', STRING: 'test', PATH: vol + 'old.txt' });

    // Export the current volume
    const exported = await extension.exportVolume({ VOL: vol });
    const data = JSON.parse(exported);

    // Remove old.txt from the tree if it exists
    if (data['import_test://'].tree.children && data['import_test://'].tree.children['old.txt']) {
      delete data['import_test://'].tree.children['old.txt'];
    }

    // Import with the modified data (without old.txt)
    const result = await extension.importVolume({
      VOL: vol,
      JSON: JSON.stringify(data),
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    // List files to see what's there
    const listStr = await extension.listFiles({ DEPTH: 'immediate', PATH: vol });
    const files = JSON.parse(listStr);

    // Old file should be gone (format clears volume, import adds back what's in export)
    assert.ok(!files.includes('old.txt'), 'old.txt should not exist after import');
  });

  it('imports volume with restrictive directory permissions correctly', async () => {
    const vol = 'perm_import_test://';

    // Create a volume with nested structure and restrictive permissions
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });
    await extension.fileWrite({ MODE: 'write', STRING: 'content1', PATH: vol + 'dir/file1.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'content2', PATH: vol + 'dir/file2.txt' });

    // Set restrictive permissions on directory
    await extension.setPermission({ PATH: vol + 'dir', PERM: 'create', VALUE: 'deny' });
    await extension.setPermission({ PATH: vol + 'dir', PERM: 'write', VALUE: 'deny' });

    // Export
    const exported = await extension.exportVolume({ VOL: vol });
    const data = JSON.parse(exported);

    // Mount fresh target volume
    await extension.mountAs({ VOL: 'perm_target://', TYPE: 'RAM' });

    // Modify export for new volume
    data['perm_target://'] = data[vol];
    delete data[vol];

    // Import should succeed despite restrictive permissions
    const result = await extension.importVolume({
      VOL: 'perm_target://',
      JSON: JSON.stringify(data),
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success', 'import should succeed with restrictive permissions');

    // Verify files were imported
    const file1 = await extension.fileRead({ PATH: 'perm_target://dir/file1.txt', FORMAT: 'text' });
    assert.equal(file1, 'content1', 'file1 should be imported');

    const file2 = await extension.fileRead({ PATH: 'perm_target://dir/file2.txt', FORMAT: 'text' });
    assert.equal(file2, 'content2', 'file2 should be imported');

    // Verify permissions were applied correctly (should be restrictive after import)
    const canCreate = await extension.checkPermission({
      PATH: 'perm_target://dir',
      PERM: 'create',
    });
    assert.equal(canCreate, false, 'create permission should be denied on imported directory');

    const canWrite = await extension.checkPermission({ PATH: 'perm_target://dir', PERM: 'write' });
    assert.equal(canWrite, false, 'write permission should be denied on imported directory');
  });

  it('imports and exports unlimited quotas correctly', async () => {
    const vol = 'unlimited_test://';

    // Mount OPFS volume with unlimited quotas
    await extension.mountAs({ VOL: vol, TYPE: 'OPFS' });

    // Verify unlimited quotas
    const volObj = extension.volumes[vol];
    assert.equal(volObj.sizeLimit, Infinity, 'OPFS should have unlimited size');
    assert.equal(volObj.fileCountLimit, Infinity, 'OPFS should have unlimited file count');

    // Add some content
    await extension.fileWrite({ MODE: 'write', STRING: 'test data', PATH: vol + 'file.txt' });

    // Export
    const exported = await extension.exportVolume({ VOL: vol });
    const data = JSON.parse(exported);

    // Verify export represents unlimited quotas with sentinel
    assert.equal(data[vol].sizeLimit, '__INFINITY__', 'exported sizeLimit should be __INFINITY__');
    assert.equal(
      data[vol].fileCountLimit,
      '__INFINITY__',
      'exported fileCountLimit should be __INFINITY__'
    );

    // Modify export for new volume (using same type so import can succeed)
    data['unlimited_target://'] = data[vol];
    // Keep the same type from the export
    delete data[vol];

    // Import (importVolume will mount the volume with the correct type from export data)
    const result = await extension.importVolume({
      VOL: 'unlimited_target://',
      JSON: JSON.stringify(data),
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success', 'import should succeed');

    // Verify imported volume has unlimited quotas
    const targetVol = extension.volumes['unlimited_target://'];
    assert.equal(targetVol.sizeLimit, Infinity, 'imported sizeLimit should be Infinity');
    assert.equal(targetVol.fileCountLimit, Infinity, 'imported fileCountLimit should be Infinity');

    // Verify content
    const content = await extension.fileRead({
      PATH: 'unlimited_target://file.txt',
      FORMAT: 'text',
    });
    assert.equal(content, 'test data', 'content should be imported');
  });

  it('handles JSON null quotas as unlimited during import', async () => {
    const vol = 'null_quota_test://';

    // Create a simulated export with null quotas (as JSON.stringify(Infinity) would produce)
    const exportData = {
      [vol]: {
        type: 'RAM',
        sizeLimit: null,
        fileCountLimit: null,
        perms: {
          read: true,
          write: true,
          create: true,
          view: true,
          delete: true,
          control: true,
        },
        tree: {
          type: 'dir',
          children: {
            'test.txt': {
              type: 'file',
              mime: 'text/plain',
              content: btoa('hello'),
              perms: {
                read: true,
                write: true,
                create: true,
                view: true,
                delete: true,
                control: true,
              },
            },
          },
        },
      },
    };

    // Mount target
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });

    // Import
    const result = await extension.importVolume({
      VOL: vol,
      JSON: JSON.stringify(exportData),
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success', 'import should succeed with null quotas');

    // Verify quotas are unlimited
    const targetVol = extension.volumes[vol];
    assert.equal(targetVol.sizeLimit, Infinity, 'null sizeLimit should become Infinity');
    assert.equal(targetVol.fileCountLimit, Infinity, 'null fileCountLimit should become Infinity');

    // Verify content
    const content = await extension.fileRead({ PATH: vol + 'test.txt', FORMAT: 'text' });
    assert.equal(content, 'hello', 'content should be imported');
  });
});

// ===== ERROR HANDLING =====

describe('triflareVolumes — error handling', () => {
  it('tracks last error', async () => {
    // Trigger error
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'test',
      PATH: 'invalid_volume://file.txt',
    });

    const error = extension.getLastError();
    const parsed = JSON.parse(error);
    assert.equal(parsed.status, 'error');
    assert.ok(parsed.code);
    assert.ok(parsed.message);
  });

  it('returns success after successful operation', async () => {
    await extension.mountAs({ VOL: 'error_test://', TYPE: 'RAM' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'ok',
      PATH: 'error_test://file.txt',
    });

    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'success');
  });

  it('handles type mismatch errors', async () => {
    const vol = 'error_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: vol + 'dir/file.txt' });

    // Try to write to directory
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'data',
      PATH: vol + 'dir',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'TYPE_MISMATCH');
  });

  it('handles not found errors', async () => {
    const _result = await extension.fileRead({
      PATH: 'error_test://missing/deep/file.txt',
      FORMAT: 'text',
    });

    // Returns empty string but lastError has details
    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'error');
    assert.equal(error.code, 'NOT_FOUND');
  });

  it('handles permission denied errors', async () => {
    const vol = 'error_test://';
    const file = vol + 'restricted.txt';

    await extension.fileWrite({ MODE: 'write', STRING: 'secret', PATH: file });
    await extension.setPermission({ PATH: file, PERM: 'read', VALUE: 'deny' });

    const _content = await extension.fileRead({
      PATH: file,
      FORMAT: 'text',
    });

    const error = JSON.parse(extension.lastError);
    assert.equal(error.status, 'error');
    assert.equal(error.code, 'PERMISSION_DENIED');
  });
});

// ===== PATH PARSING & VALIDATION =====

describe('triflareVolumes — path parsing', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'parse_test://', TYPE: 'RAM' });
  });

  it('handles paths with multiple :// in content', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'contains protocol-like string://text',
      PATH: 'parse_test://protocol_in_name.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({
      PATH: 'parse_test://protocol_in_name.txt',
      FORMAT: 'text',
    });
    assert.ok(content.includes('://'));
  });

  it('strips trailing slashes from paths', async () => {
    const vol = 'parse_test://';

    // Write to file with trailing slash (should be normalized)
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'content',
      PATH: vol + 'file_a.txt',
    });

    // Read with and without trailing slashes
    const content = await extension.fileRead({
      PATH: vol + 'file_a.txt/',
      FORMAT: 'text',
    });

    assert.equal(content, 'content');
  });

  it('rejects plain file paths without volume', async () => {
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'test',
      PATH: 'no_volume_file.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'error');
  });

  it('caches path parsing', async () => {
    const vol = 'parse_test://';

    // Write multiple times to same path (should use cache)
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'data1',
      PATH: vol + 'cached.txt',
    });

    const _content1 = await extension.fileRead({
      PATH: vol + 'cached.txt',
      FORMAT: 'text',
    });

    await extension.fileWrite({
      MODE: 'write',
      STRING: 'data2',
      PATH: vol + 'cached.txt',
    });

    const content2 = await extension.fileRead({
      PATH: vol + 'cached.txt',
      FORMAT: 'text',
    });

    assert.equal(content2, 'data2');
  });
});

// ===== INTEGRATION TESTS =====

describe('triflareVolumes — integration scenarios', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'integration_test://', TYPE: 'RAM' });
  });

  it('handles complex workflow with directories and permissions', async () => {
    const vol = 'integration_test://';

    // Create structure
    await extension.fileWrite({ MODE: 'write', STRING: 'public', PATH: vol + 'public/file.txt' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'secret',
      PATH: vol + 'private/secret.txt',
    });

    // Set permissions
    await extension.setPermission({ PATH: vol + 'public', PERM: 'read', VALUE: 'allow' });
    await extension.setPermission({ PATH: vol + 'private', PERM: 'read', VALUE: 'deny' });

    // List should show both
    const list1 = JSON.parse(await extension.listFiles({ DEPTH: 'immediate', PATH: vol }));
    assert.ok(list1.includes('public'));
    assert.ok(list1.includes('private'));

    // Read public should work
    const pub = await extension.fileRead({ PATH: vol + 'public/file.txt', FORMAT: 'text' });
    assert.equal(pub, 'public');
  });

  it('supports round-trip export/import cycle', async () => {
    const vol = 'integration_test://';

    // Create test data
    await extension.formatVolume({ VOL: vol });
    await extension.fileWrite({ MODE: 'write', STRING: 'a', PATH: vol + 'a.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'b', PATH: vol + 'b/c.txt' });

    // Set complex permissions
    await extension.setPermission({ PATH: vol + 'a.txt', PERM: 'write', VALUE: 'deny' });

    // Export
    const exported = await extension.exportVolume({ VOL: vol });
    const data1 = JSON.parse(exported);

    // Mount new volume
    await extension.mountAs({ VOL: 'roundtrip_test://', TYPE: 'RAM' });

    // Prepare import
    data1['roundtrip_test://'] = data1['integration_test://'];
    delete data1['integration_test://'];

    // Import
    await extension.importVolume({
      VOL: 'roundtrip_test://',
      JSON: JSON.stringify(data1),
    });

    // Verify content exists
    const fileList = JSON.parse(
      await extension.listFiles({ DEPTH: 'all', PATH: 'roundtrip_test://' })
    );
    assert.ok(fileList.length > 0, 'should have files after import');

    // Verify we can read the files
    const aContent = await extension.fileRead({ PATH: 'roundtrip_test://a.txt', FORMAT: 'text' });
    assert.equal(aContent, 'a');

    // Export again to verify structure
    const exported2 = await extension.exportVolume({ VOL: 'roundtrip_test://' });
    const data2 = JSON.parse(exported2);
    assert.ok(data2['roundtrip_test://'], 'roundtrip volume should exist');
    assert.ok(data2['roundtrip_test://'].tree, 'should have tree');
  });

  it('handles many files in volume', async () => {
    const vol = 'integration_test://';

    // Add many files
    for (let i = 0; i < 50; i++) {
      await extension.fileWrite({
        MODE: 'write',
        STRING: `file ${i}`,
        PATH: vol + `files/file_${i}.txt`,
      });
    }

    // List all
    const listStr = await extension.listFiles({ DEPTH: 'all', PATH: vol });
    const files = JSON.parse(listStr);

    assert.ok(files.length >= 50);
  });

  it('performs integrity test', async () => {
    const result = await extension.runIntegrityTest();
    assert.equal(result, 'OK', 'integrity test should pass');
  });
});

// ===== EDGE CASES =====

describe('triflareVolumes — edge cases', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'edge_test://', TYPE: 'RAM' });
  });

  it('handles empty file content', async () => {
    const vol = 'edge_test://';
    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: '',
      PATH: vol + 'empty.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'empty.txt', FORMAT: 'text' });
    assert.equal(content, '');
  });

  it('handles very long filenames', async () => {
    const vol = 'edge_test://';
    const longName = 'a'.repeat(1000) + '.txt';

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'content',
      PATH: vol + longName,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('handles special characters in paths', async () => {
    const vol = 'edge_test://';

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'special',
      PATH: vol + 'file-with_special.chars.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('coerces numeric path to string', async () => {
    const vol = 'edge_test://';

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'numeric path',
      PATH: vol + 'numbers_123.txt',
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');
  });

  it('handles whitespace in volume names', async () => {
    const _result = await extension.mountAs({
      VOL: 'vol with spaces',
      TYPE: 'RAM',
    });

    // Assert mountAs success
    const resultStatus = JSON.parse(_result);
    assert.equal(resultStatus.status, 'success');

    // Should normalize volume name by trimming and adding ://
    const volumes = JSON.parse(await extension.listVolumes());
    const expectedNormalizedName = 'vol with spaces://';
    assert.ok(
      volumes.some(v => v === expectedNormalizedName),
      `Expected to find '${expectedNormalizedName}' in volumes`
    );
  });

  it('respects deeply nested directory creation', async () => {
    const vol = 'edge_test://';
    const deepPath = vol + 'a/b/c/d/e/f/g/h/i/j/file.txt';

    const result = await extension.fileWrite({
      MODE: 'write',
      STRING: 'deep',
      PATH: deepPath,
    });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const exists = await extension.pathCheck({
      PATH: deepPath,
      CONDITION: 'exists',
    });
    assert.equal(exists, true);
  });
});

// ===== CONCURRENT OPERATIONS =====

describe('triflareVolumes — concurrent operations', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'concurrent_test://', TYPE: 'RAM' });
  });

  it('handles concurrent writes to different files', async () => {
    const vol = 'concurrent_test://';

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        extension.fileWrite({
          MODE: 'write',
          STRING: `content ${i}`,
          PATH: vol + `file_${i}.txt`,
        })
      );
    }

    const results = await Promise.all(promises);
    const allSuccess = results.every(r => JSON.parse(r).status === 'success');
    assert.equal(allSuccess, true);
  });

  it('handles sequential operations maintaining state', async () => {
    const vol = 'concurrent_test://';

    await extension.fileWrite({ MODE: 'write', STRING: 'start', PATH: vol + 'seq.txt' });
    await extension.fileWrite({ MODE: 'append', STRING: '-middle', PATH: vol + 'seq.txt' });
    await extension.fileWrite({ MODE: 'append', STRING: '-end', PATH: vol + 'seq.txt' });

    const content = await extension.fileRead({ PATH: vol + 'seq.txt', FORMAT: 'text' });
    assert.equal(content, 'start-middle-end');
  });
});

// ===== TRANSACTIONS =====

describe('triflareVolumes — transactions', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'txn_test://', TYPE: 'RAM' });
    await extension.formatVolume({ VOL: 'txn_test://' });
  });

  it('begins and lists an active transaction', async () => {
    const result = await extension.beginTransaction({ TXN: 'tx1', VOL: 'txn_test://' });
    const status = JSON.parse(result);
    assert.equal(status.status, 'success');

    const listed = JSON.parse(await extension.listTransactions());
    assert.ok(Array.isArray(listed));
    assert.ok(listed.some(t => t.volume === 'txn_test://' && t.name === 'tx1'));

    const commit = await extension.commitTransaction({ VOL: 'txn_test://' });
    const commitStatus = JSON.parse(commit);
    assert.equal(commitStatus.status, 'success');
  });

  it('rolls back file changes made during an active transaction', async () => {
    const vol = 'txn_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'before', PATH: vol + 'state.txt' });
    await extension.beginTransaction({ TXN: 'tx-rollback', VOL: vol });
    await extension.fileWrite({ MODE: 'write', STRING: 'after', PATH: vol + 'state.txt' });

    const rollback = await extension.rollbackTransaction({ VOL: vol });
    const rollbackStatus = JSON.parse(rollback);
    assert.equal(rollbackStatus.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'state.txt', FORMAT: 'text' });
    assert.equal(content, 'before');
  });

  it('commits transaction and removes it from active list', async () => {
    const vol = 'txn_test://';
    await extension.beginTransaction({ TXN: 'tx2', VOL: vol });
    await extension.fileWrite({ MODE: 'write', STRING: 'keep', PATH: vol + 'committed.txt' });

    const commit = await extension.commitTransaction({ VOL: vol });
    const commitStatus = JSON.parse(commit);
    assert.equal(commitStatus.status, 'success');

    const listed = JSON.parse(await extension.listTransactions());
    assert.ok(!listed.some(t => t.volume === vol));
    const content = await extension.fileRead({ PATH: vol + 'committed.txt', FORMAT: 'text' });
    assert.equal(content, 'keep');
  });

  it('rejects beginTransaction when exported snapshot exceeds configured size limit', async () => {
    const vol = 'txn_test://';
    const originalLimit = extension._maxTransactionSnapshotBytes;
    extension._maxTransactionSnapshotBytes = 16;
    try {
      await extension.fileWrite({
        MODE: 'write',
        STRING: 'payload-over-limit',
        PATH: vol + 'big.txt',
      });
      const res = await extension.beginTransaction({ TXN: 'too-big', VOL: vol });
      const status = JSON.parse(res);
      assert.equal(status.status, 'error');
      assert.equal(status.code, 'INVALID_ARGUMENT');
      assert.ok(status.message.includes('snapshot exceeds'));
    } finally {
      extension._maxTransactionSnapshotBytes = originalLimit;
    }
  });
});

// ===== SNAPSHOTS =====

describe('triflareVolumes — snapshots', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'snap_test://', TYPE: 'RAM' });
    await extension.formatVolume({ VOL: 'snap_test://' });
  });

  it('creates and lists snapshots', async () => {
    const vol = 'snap_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'v1', PATH: vol + 'a.txt' });
    const res = await extension.createSnapshot({ SNAP: 's1', VOL: vol });
    const status = JSON.parse(res);
    assert.equal(status.status, 'success');

    const list = JSON.parse(await extension.listSnapshots({ VOL: vol }));
    assert.ok(list.includes('s1'));
  });

  it('restores a previous snapshot', async () => {
    const vol = 'snap_test://';
    await extension.fileWrite({ MODE: 'write', STRING: 'v2', PATH: vol + 'a.txt' });
    await extension.createSnapshot({ SNAP: 's2', VOL: vol });
    await extension.fileWrite({ MODE: 'write', STRING: 'v3', PATH: vol + 'a.txt' });

    const restore = await extension.restoreSnapshot({ SNAP: 's1', VOL: vol });
    const status = JSON.parse(restore);
    assert.equal(status.status, 'success');

    const content = await extension.fileRead({ PATH: vol + 'a.txt', FORMAT: 'text' });
    assert.equal(content, 'v1');
  });

  it('diffs snapshots and reports changed paths', async () => {
    const vol = 'snap_test://';
    const diffStr = await extension.diffSnapshots({ A: 's1', B: 's2', VOL: vol });
    const diff = JSON.parse(diffStr);
    assert.equal(diff.volume, vol);
    assert.ok(Array.isArray(diff.changed));
    assert.ok(diff.changed.includes('a.txt'));
  });

  it('deletes a named snapshot', async () => {
    const vol = 'snap_test://';
    await extension.createSnapshot({ SNAP: 'to-delete', VOL: vol });
    const before = JSON.parse(await extension.listSnapshots({ VOL: vol }));
    assert.ok(before.includes('to-delete'));

    const res = await extension.deleteSnapshot({ SNAP: 'to-delete', VOL: vol });
    const status = JSON.parse(res);
    assert.equal(status.status, 'success');

    const after = JSON.parse(await extension.listSnapshots({ VOL: vol }));
    assert.ok(!after.includes('to-delete'));
  });

  it('enforces per-volume snapshot limit for new snapshot names', async () => {
    const vol = 'snap_limit_test://';
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });
    await extension.formatVolume({ VOL: vol });

    const originalLimit = extension._maxSnapshotsPerVolume;
    extension._maxSnapshotsPerVolume = 2;
    try {
      await extension.createSnapshot({ SNAP: 'limit-1', VOL: vol });
      await extension.createSnapshot({ SNAP: 'limit-2', VOL: vol });
      const over = await extension.createSnapshot({ SNAP: 'limit-3', VOL: vol });
      const overStatus = JSON.parse(over);
      assert.equal(overStatus.status, 'error');
      assert.equal(overStatus.code, 'QUOTA_EXCEEDED');

      const overwrite = await extension.createSnapshot({ SNAP: 'limit-2', VOL: vol });
      const overwriteStatus = JSON.parse(overwrite);
      assert.equal(overwriteStatus.status, 'success');
    } finally {
      extension._maxSnapshotsPerVolume = originalLimit;
    }
  });
});

// ===== WATCHERS =====

describe('triflareVolumes — watcher events', () => {
  before(async () => {
    await extension.mountAs({ VOL: 'watch_test://', TYPE: 'RAM' });
    await extension.formatVolume({ VOL: 'watch_test://' });
  });

  it('captures write/delete/permission events for watched path', async () => {
    const vol = 'watch_test://';
    const watcher = await extension.watchPath({ PATH: vol, DEPTH: 'all' });
    assert.ok(watcher);

    await extension.fileWrite({ MODE: 'write', STRING: 'x', PATH: vol + 'f.txt' });
    await extension.setPermission({ PATH: vol + 'f.txt', PERM: 'read', VALUE: 'deny' });
    await extension.deletePath({ PATH: vol + 'f.txt' });

    const events = JSON.parse(await extension.pollWatcherEvents({ WATCHER: watcher }));
    const types = events.map(e => e.type);
    assert.ok(types.includes('write'));
    assert.ok(types.includes('permission'));
    assert.ok(types.includes('delete'));
  });

  it('returns no events after polling cursor is advanced', async () => {
    const vol = 'watch_test://';
    const watcher = await extension.watchPath({ PATH: vol, DEPTH: 'all' });
    await extension.fileWrite({ MODE: 'write', STRING: 'first', PATH: vol + 'cursor.txt' });
    const first = JSON.parse(await extension.pollWatcherEvents({ WATCHER: watcher }));
    assert.ok(first.length >= 1);
    const second = JSON.parse(await extension.pollWatcherEvents({ WATCHER: watcher }));
    assert.equal(second.length, 0);
    await extension.unwatchPath({ WATCHER: watcher });
  });

  it('retains watcher polling correctness when old events are pruned', async () => {
    const vol = 'watch_test://';
    await extension.formatVolume({ VOL: vol });
    const originalLimit = extension._maxEventLogEntries;
    extension._maxEventLogEntries = 3;
    try {
      const oldWatcher = await extension.watchPath({ PATH: vol, DEPTH: 'all' });
      const newWatcher = await extension.watchPath({ PATH: vol, DEPTH: 'all' });
      await extension.unwatchPath({ WATCHER: oldWatcher });

      await extension.fileWrite({ MODE: 'write', STRING: '1', PATH: vol + 'p1.txt' });
      await extension.fileWrite({ MODE: 'write', STRING: '2', PATH: vol + 'p2.txt' });
      await extension.fileWrite({ MODE: 'write', STRING: '3', PATH: vol + 'p3.txt' });
      await extension.fileWrite({ MODE: 'write', STRING: '4', PATH: vol + 'p4.txt' });

      const events = JSON.parse(await extension.pollWatcherEvents({ WATCHER: newWatcher }));
      assert.equal(events.length, 3);
      assert.deepEqual(
        events.map(e => e.path),
        [vol + 'p2.txt', vol + 'p3.txt', vol + 'p4.txt']
      );
      await extension.unwatchPath({ WATCHER: newWatcher });
    } finally {
      extension._maxEventLogEntries = originalLimit;
    }
  });

  it('emits append event when append creates a missing file', async () => {
    const vol = 'watch_test://';
    await extension.formatVolume({ VOL: vol });
    const watcher = await extension.watchPath({ PATH: vol, DEPTH: 'all' });
    await extension.fileWrite({
      MODE: 'append',
      STRING: 'new',
      PATH: vol + 'created-by-append.txt',
    });
    const events = JSON.parse(await extension.pollWatcherEvents({ WATCHER: watcher }));
    const appendCreated = events.find(
      e => e.type === 'append' && e.path === vol + 'created-by-append.txt'
    );
    assert.ok(appendCreated, 'expected append event for file created via append');
    await extension.unwatchPath({ WATCHER: watcher });
  });
});

// ===== VIRTUAL ARCHIVE (VARCH) =====

describe('triflareVolumes — virtual archive (VArch)', () => {
  let archiveJSON;

  before(async () => {
    // Build a small RAM volume and export it so tests have a valid archive payload
    const src = 'varch_src://';
    await extension.mountAs({ VOL: src, TYPE: 'RAM' });
    await extension.formatVolume({ VOL: src });
    await extension.fileWrite({ MODE: 'write', STRING: 'hello archive', PATH: src + 'readme.txt' });
    await extension.fileWrite({
      MODE: 'write',
      STRING: 'data:text/plain;base64,' + btoa('binary data'),
      PATH: src + 'sub/data.bin',
    });
    archiveJSON = await extension.exportVolume({ VOL: src });
  });

  it('mounts a VARCH volume from exported JSON', async () => {
    const res = await extension.mountArchive({ JSON: archiveJSON, VOL: 'arc1://' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'success');
    const vols = JSON.parse(await extension.listVolumes());
    assert.ok(vols.includes('arc1://'));
  });

  it('reads a file from a VARCH volume', async () => {
    const content = await extension.fileRead({ PATH: 'arc1://readme.txt', FORMAT: 'text' });
    assert.equal(content, 'hello archive');
  });

  it('reads a file in a subdirectory from a VARCH volume', async () => {
    const content = await extension.fileRead({ PATH: 'arc1://sub/data.bin', FORMAT: 'text' });
    assert.equal(content, 'binary data');
  });

  it('listFiles returns files from a VARCH volume', async () => {
    const files = JSON.parse(await extension.listFiles({ DEPTH: 'immediate', PATH: 'arc1://' }));
    assert.ok(files.includes('readme.txt'), 'should list readme.txt');
    assert.ok(files.includes('sub'), 'should list sub directory');
  });

  it('listFiles returns all files recursively from a VARCH volume', async () => {
    const files = JSON.parse(await extension.listFiles({ DEPTH: 'all', PATH: 'arc1://' }));
    assert.ok(files.includes('readme.txt'));
    assert.ok(files.includes('sub/data.bin'));
  });

  it('pathCheck: exists returns true for a VARCH file', async () => {
    const exists = await extension.pathCheck({ PATH: 'arc1://readme.txt', CONDITION: 'exists' });
    assert.equal(exists, true);
  });

  it('pathCheck: is a directory returns true for a VARCH directory', async () => {
    const isDir = await extension.pathCheck({ PATH: 'arc1://sub', CONDITION: 'is a directory' });
    assert.equal(isDir, true);
  });

  it('checkPermission: read is allowed on a VARCH path', async () => {
    const canRead = await extension.checkPermission({ PATH: 'arc1://readme.txt', PERM: 'read' });
    assert.equal(canRead, true);
  });

  it('checkPermission: write is denied on a VARCH path', async () => {
    const canWrite = await extension.checkPermission({ PATH: 'arc1://readme.txt', PERM: 'write' });
    assert.equal(canWrite, false);
  });

  it('write to VARCH returns FORBIDDEN error', async () => {
    const res = await extension.fileWrite({
      MODE: 'write',
      STRING: 'should fail',
      PATH: 'arc1://readme.txt',
    });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'FORBIDDEN');
  });

  it('append to VARCH returns FORBIDDEN error', async () => {
    const res = await extension.fileWrite({
      MODE: 'append',
      STRING: 'should fail',
      PATH: 'arc1://readme.txt',
    });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'FORBIDDEN');
  });

  it('delete on VARCH returns FORBIDDEN error', async () => {
    const res = await extension.deletePath({ PATH: 'arc1://readme.txt' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'FORBIDDEN');
  });

  it('format on VARCH returns FORBIDDEN error', async () => {
    const res = await extension.formatVolume({ VOL: 'arc1://' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'FORBIDDEN');
  });

  it('setPermission on VARCH returns FORBIDDEN error', async () => {
    const res = await extension.setPermission({
      PATH: 'arc1://readme.txt',
      PERM: 'read',
      VALUE: 'deny',
    });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'FORBIDDEN');
  });

  it('rejects mounting an archive over an already-mounted volume', async () => {
    const res = await extension.mountArchive({ JSON: archiveJSON, VOL: 'arc1://' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'TYPE_MISMATCH');
  });

  it('rejects invalid JSON for mountArchive', async () => {
    const res = await extension.mountArchive({ JSON: 'not-json', VOL: 'arc_bad://' });
    const status = JSON.parse(res);
    assert.equal(status.status, 'error');
    assert.equal(status.code, 'INVALID_ARGUMENT');
  });
});

// ===== SNAPSHOT DELTA =====

describe('triflareVolumes — snapshotDelta', () => {
  before(async () => {
    const vol = 'delta_test://';
    await extension.mountAs({ VOL: vol, TYPE: 'RAM' });
    await extension.formatVolume({ VOL: vol });
    // snap_a: has a.txt and common.txt
    await extension.fileWrite({ MODE: 'write', STRING: 'original', PATH: vol + 'common.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'will-be-deleted', PATH: vol + 'a.txt' });
    await extension.createSnapshot({ SNAP: 'snap_a', VOL: vol });
    // snap_b: deletes a.txt, modifies common.txt, adds b.txt
    await extension.deletePath({ PATH: vol + 'a.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'modified', PATH: vol + 'common.txt' });
    await extension.fileWrite({ MODE: 'write', STRING: 'brand-new', PATH: vol + 'b.txt' });
    await extension.createSnapshot({ SNAP: 'snap_b', VOL: vol });
  });

  it('returns added, modified, deleted arrays', async () => {
    const deltaStr = await extension.snapshotDelta({
      SNAP1: 'snap_a',
      SNAP2: 'snap_b',
      VOL: 'delta_test://',
    });
    const delta = JSON.parse(deltaStr);
    assert.ok(Array.isArray(delta.added), 'should have added array');
    assert.ok(Array.isArray(delta.modified), 'should have modified array');
    assert.ok(Array.isArray(delta.deleted), 'should have deleted array');
  });

  it('added entries have path, mime, and content fields', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    const addedEntry = delta.added.find(e => e.path === 'b.txt');
    assert.ok(addedEntry, 'b.txt should be in added');
    assert.ok(typeof addedEntry.mime === 'string', 'added entry should have mime');
    assert.ok(typeof addedEntry.content === 'string', 'added entry should have content');
  });

  it('modified entries have path, mime, before, and after fields', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    const modEntry = delta.modified.find(e => e.path === 'common.txt');
    assert.ok(modEntry, 'common.txt should be in modified');
    assert.ok(typeof modEntry.mime === 'string', 'modified entry should have mime');
    assert.ok(typeof modEntry.before === 'string', 'modified entry should have before content');
    assert.ok(typeof modEntry.after === 'string', 'modified entry should have after content');
    assert.notEqual(modEntry.before, modEntry.after, 'before and after should differ');
  });

  it('deleted entries have path, mime, and content fields', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    const delEntry = delta.deleted.find(e => e.path === 'a.txt');
    assert.ok(delEntry, 'a.txt should be in deleted');
    assert.ok(typeof delEntry.mime === 'string', 'deleted entry should have mime');
    assert.ok(typeof delEntry.content === 'string', 'deleted entry should have content');
  });

  it('correctly identifies added paths', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    assert.ok(
      delta.added.some(e => e.path === 'b.txt'),
      'b.txt should be in added'
    );
    assert.ok(!delta.added.some(e => e.path === 'common.txt'), 'common.txt should not be added');
    assert.ok(!delta.added.some(e => e.path === 'a.txt'), 'a.txt should not be added');
  });

  it('correctly identifies modified paths', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    assert.ok(
      delta.modified.some(e => e.path === 'common.txt'),
      'common.txt should be modified'
    );
    assert.ok(
      !delta.modified.some(e => e.path === 'a.txt'),
      'deleted a.txt should not be in modified'
    );
    assert.ok(!delta.modified.some(e => e.path === 'b.txt'), 'new b.txt should not be in modified');
  });

  it('correctly identifies deleted paths', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    assert.ok(
      delta.deleted.some(e => e.path === 'a.txt'),
      'a.txt should be deleted'
    );
    assert.ok(!delta.deleted.some(e => e.path === 'b.txt'), 'new b.txt should not be deleted');
    assert.ok(
      !delta.deleted.some(e => e.path === 'common.txt'),
      'common.txt should not be deleted'
    );
  });

  it('identical snapshots return empty delta arrays', async () => {
    // snap_a and snap_a are identical — nothing should be in any delta array
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_a', VOL: 'delta_test://' })
    );
    assert.equal(delta.added.length, 0, 'identical snapshots should have no added');
    assert.equal(delta.modified.length, 0, 'identical snapshots should have no modified');
    assert.equal(delta.deleted.length, 0, 'identical snapshots should have no deleted');
  });

  it('before/after content is base64 and decodes to the written strings', async () => {
    const delta = JSON.parse(
      await extension.snapshotDelta({ SNAP1: 'snap_a', SNAP2: 'snap_b', VOL: 'delta_test://' })
    );
    const modEntry = delta.modified.find(e => e.path === 'common.txt');
    assert.equal(atob(modEntry.before), 'original', 'before should decode to original content');
    assert.equal(atob(modEntry.after), 'modified', 'after should decode to modified content');
    const delEntry = delta.deleted.find(e => e.path === 'a.txt');
    assert.equal(
      atob(delEntry.content),
      'will-be-deleted',
      'deleted content should be recoverable'
    );
    const addEntry = delta.added.find(e => e.path === 'b.txt');
    assert.equal(atob(addEntry.content), 'brand-new', 'added content should be present');
  });

  it('returns error for missing snapshot', async () => {
    const deltaStr = await extension.snapshotDelta({
      SNAP1: 'does-not-exist',
      SNAP2: 'snap_b',
      VOL: 'delta_test://',
    });
    const delta = JSON.parse(deltaStr);
    // On error, snapshotDelta returns fallback { added:[], modified:[], deleted:[] }
    assert.ok(Array.isArray(delta.added) && delta.added.length === 0);
    const err = JSON.parse(extension.lastError);
    assert.equal(err.status, 'error');
    assert.equal(err.code, 'NOT_FOUND');
  });
});

// ===== ADVANCED BLOCK TOGGLE =====

describe('triflareVolumes — advanced block toggle', () => {
  beforeEach(() => {
    extension._advancedBlocksHidden = true;
    Scratch.vm.extensionManager._refreshBlocksCalls = 0;
  });

  it('starts with advanced blocks hidden by default', () => {
    assert.equal(extension._advancedBlocksHidden, true);
    const info = extension.getInfo();
    const txBlock = info.blocks.find(b => b.opcode === 'beginTransaction');
    assert.equal(txBlock.hideFromPalette, true, 'beginTransaction should be hidden initially');
    const snapBlock = info.blocks.find(b => b.opcode === 'snapshotDelta');
    assert.equal(snapBlock.hideFromPalette, true, 'snapshotDelta should be hidden initially');
  });

  it('toggle button text reflects current hidden state (hidden → "Show")', () => {
    const info = extension.getInfo();
    const button = info.blocks.find(b => b.blockType === Scratch.BlockType.BUTTON);
    assert.ok(button, 'BUTTON block should exist');
    assert.ok(button.text.includes('Show'), 'button should say "Show" when blocks are hidden');
  });

  it('toggleAdvancedBlocks reveals advanced blocks', () => {
    const beforeCalls = Scratch.vm.extensionManager._refreshBlocksCalls || 0;
    extension.toggleAdvancedBlocks();
    assert.equal(extension._advancedBlocksHidden, false);
    const info = extension.getInfo();
    const txBlock = info.blocks.find(b => b.opcode === 'beginTransaction');
    assert.equal(txBlock.hideFromPalette, false, 'beginTransaction should be visible after toggle');
    const snapBlock = info.blocks.find(b => b.opcode === 'snapshotDelta');
    assert.equal(snapBlock.hideFromPalette, false, 'snapshotDelta should be visible after toggle');
    const afterCalls = Scratch.vm.extensionManager._refreshBlocksCalls || 0;
    assert.equal(afterCalls, beforeCalls + 1, 'refreshBlocks should be called once');
  });

  it('toggle button text reflects current state (visible → "Hide")', () => {
    const info = extension.getInfo();
    const button = info.blocks.find(b => b.blockType === Scratch.BlockType.BUTTON);
    assert.ok(button.text.includes('Hide'), 'button should say "Hide" when blocks are visible');
  });

  it('toggleAdvancedBlocks hides blocks again on second call', () => {
    const beforeCalls = Scratch.vm.extensionManager._refreshBlocksCalls || 0;
    extension.toggleAdvancedBlocks();
    assert.equal(extension._advancedBlocksHidden, true);
    const info = extension.getInfo();
    const txBlock = info.blocks.find(b => b.opcode === 'beginTransaction');
    assert.equal(txBlock.hideFromPalette, true, 'beginTransaction should be hidden again');
    const afterCalls = Scratch.vm.extensionManager._refreshBlocksCalls || 0;
    assert.equal(afterCalls, beforeCalls + 1, 'refreshBlocks should be called once');
  });
});