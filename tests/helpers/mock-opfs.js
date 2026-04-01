/**
 * In-memory OPFS mock for unit testing Volumes extension helpers.
 *
 * Implements the subset of the FileSystem Access API used by 02-volumes.js:
 *   FileSystemDirectoryHandle  — getFileHandle, getDirectoryHandle, removeEntry, keys()
 *   FileSystemFileHandle       — getFile(), createWritable()
 *   FileSystemWritableFileStream — write(), close()
 *
 * Install the mock as a global before importing any source module that
 * references `navigator.storage`, then call `restore()` when done.
 *
 * @example
 * import { createMockOpfs } from './helpers/mock-opfs.js';
 * const { install } = createMockOpfs();
 * const restore = install();
 * // ... import extension modules and run assertions ...
 * restore();
 */

/**
 * In-memory file handle whose content can be read and overwritten.
 */
class MockFileHandle {
  constructor(name) {
    this.name = name;
    this._content = '';
  }

  async getFile() {
    const content = this._content;
    return {
      async text() {
        return content;
      },
    };
  }

  async createWritable() {
    let staged = '';
    const self = this;
    return {
      async write(data) {
        staged = String(data);
      },
      async close() {
        self._content = staged;
      },
    };
  }
}

/**
 * In-memory directory handle backed by a Map of child entries.
 */
class MockDirectoryHandle {
  constructor() {
    /** @type {Map<string, MockFileHandle|MockDirectoryHandle>} */
    this._entries = new Map();
  }

  async getFileHandle(name, { create = false } = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (!(entry instanceof MockFileHandle)) {
        const err = new Error(`${name} is a directory, not a file`);
        err.name = 'TypeMismatchError';
        throw err;
      }
      return entry;
    }
    if (!create) {
      const err = new Error(`${name} not found`);
      err.name = 'NotFoundError';
      throw err;
    }
    const handle = new MockFileHandle(name);
    this._entries.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (!(entry instanceof MockDirectoryHandle)) {
        const err = new Error(`${name} is a file, not a directory`);
        err.name = 'TypeMismatchError';
        throw err;
      }
      return entry;
    }
    if (!create) {
      const err = new Error(`${name} not found`);
      err.name = 'NotFoundError';
      throw err;
    }
    const dir = new MockDirectoryHandle();
    this._entries.set(name, dir);
    return dir;
  }

  async removeEntry(name, _opts = {}) {
    if (!this._entries.has(name)) {
      const err = new Error(`${name} not found`);
      err.name = 'NotFoundError';
      throw err;
    }
    this._entries.delete(name);
  }

  async *keys() {
    for (const key of this._entries.keys()) {
      yield key;
    }
  }
}

/**
 * Create a fresh in-memory OPFS root and an installer function.
 *
 * **Shared-state note:** all calls to functions imported from `02-volumes.js`
 * within a test file share the same `root` instance returned here.  To avoid
 * inter-test pollution, either use unique path names in each test case or call
 * `reset()` between suites.  Because Node.js runs each test file in its own
 * worker thread the state never leaks across files.
 *
 * @returns {{ root: MockDirectoryHandle, install: () => () => void, reset: () => void }}
 *   `root`    — the root MockDirectoryHandle (inspect state directly in tests).
 *   `install` — call to mount the mock as `navigator.storage`; returns a
 *               `restore` function that undoes the installation.
 *   `reset`   — clears all entries from the root (useful between test suites).
 */
export function createMockOpfs() {
  const root = new MockDirectoryHandle();

  function install() {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const mockNavigator = {
      ...(typeof globalThis.navigator === 'object' && globalThis.navigator !== null
        ? globalThis.navigator
        : {}),
      storage: {
        getDirectory: async () => root,
      },
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });

    return function restore() {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalDescriptor);
      } else {
        try {
          delete globalThis.navigator;
        } catch (_e) {
          /* ignore on non-configurable globals */
        }
      }
    };
  }

  function reset() {
    root._entries.clear();
  }

  return { root, install, reset };
}
