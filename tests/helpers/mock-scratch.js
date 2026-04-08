/**
 * Minimal Scratch environment mock for unit testing TurboWarp extensions.
 *
 * Install the mock as a global before importing any source module that
 * references the `Scratch` global, then call `restore()` when done.
 *
 * @example
 * import { installScratchMock } from './helpers/mock-scratch.js';
 * const { mock, restore } = installScratchMock();
 * // ... import extension modules ...
 * // ... run assertions ...
 * restore();
 */

/**
 * Create a fresh Scratch mock object.
 * @returns {object} Mock Scratch object.
 */
export function createScratchMock() {
  return {
    extensions: {
      register: () => {},
      unsandboxed: false,
    },
    translate: text => text,
    BlockType: {
      BOOLEAN: 'Boolean',
      BUTTON: 'button',
      COMMAND: 'command',
      HAT: 'hat',
      LOOP: 'loop',
      REPORTER: 'reporter',
    },
    ArgumentType: {
      ANGLE: 'angle',
      BOOLEAN: 'Boolean',
      COLOR: 'color',
      IMAGE: 'image',
      NUMBER: 'number',
      STRING: 'string',
    },
    vm: {
      extensionManager: {
        refreshBlocks() {
          // Track calls for test assertions
          if (!this._refreshBlocksCalls) this._refreshBlocksCalls = 0;
          this._refreshBlocksCalls++;
        },
      },
    },
  };
}

/**
 * Install a Scratch mock as `globalThis.Scratch` so that extension source
 * modules which reference the `Scratch` global work in Node.js tests.
 *
 * @returns {{ mock: object, restore: () => void }}
 *   `mock`    — the installed Scratch mock (mutate to override behaviour).
 *   `restore` — call to remove or restore the original global value.
 */
export function installScratchMock() {
  const original = globalThis.Scratch;
  const mock = createScratchMock();
  globalThis.Scratch = mock;

  return {
    mock,
    restore: () => {
      if (original === undefined) {
        delete globalThis.Scratch;
      } else {
        globalThis.Scratch = original;
      }
    },
  };
}
