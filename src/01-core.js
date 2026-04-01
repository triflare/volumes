/**
 * Core Extension Module — Volumes
 * OPFS-powered virtual file system extension for TurboWarp.
 * Load this first (01-* naming convention).
 */

import {
  writeFileImpl,
  readFileImpl,
  deleteFileImpl,
  fileExistsImpl,
  listFilesImpl,
  makeDirImpl,
  deleteDirImpl,
} from './02-volumes.js';

class VolumesExtension {
  /**
   * Return extension info for Scratch.
   * This method is required by the Scratch extension protocol.
   */
  getInfo() {
    return {
      id: 'volumes',
      name: Scratch.translate('Volumes'),
      color1: '#3d7eba',
      color2: '#2d6ba8',
      color3: '#1e5a99',
      blocks: [
        {
          opcode: 'writeFile',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('write [CONTENT] to [PATH] in OPFS'),
          arguments: {
            CONTENT: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'hello',
            },
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'file.txt',
            },
          },
        },
        {
          opcode: 'readFile',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('read [PATH] from OPFS'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'file.txt',
            },
          },
        },
        {
          opcode: 'deleteFile',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('delete [PATH] from OPFS'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'file.txt',
            },
          },
        },
        {
          opcode: 'fileExists',
          blockType: Scratch.BlockType.BOOLEAN,
          text: Scratch.translate('[PATH] exists in OPFS'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'file.txt',
            },
          },
        },
        {
          opcode: 'listFiles',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('list files in [DIR] in OPFS'),
          arguments: {
            DIR: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/',
            },
          },
        },
        {
          opcode: 'makeDir',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('create directory [DIR] in OPFS'),
          arguments: {
            DIR: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'myfolder',
            },
          },
        },
        {
          opcode: 'deleteDir',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('delete directory [DIR] from OPFS'),
          arguments: {
            DIR: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'myfolder',
            },
          },
        },
      ],
    };
  }

  /**
   * Block implementation: Write file (delegates to 02-volumes.js)
   */
  writeFile(args) {
    return writeFileImpl(args);
  }

  /**
   * Block implementation: Read file (delegates to 02-volumes.js)
   */
  readFile(args) {
    return readFileImpl(args);
  }

  /**
   * Block implementation: Delete file (delegates to 02-volumes.js)
   */
  deleteFile(args) {
    return deleteFileImpl(args);
  }

  /**
   * Block implementation: File exists (delegates to 02-volumes.js)
   */
  fileExists(args) {
    return fileExistsImpl(args);
  }

  /**
   * Block implementation: List files (delegates to 02-volumes.js)
   */
  listFiles(args) {
    return listFilesImpl(args);
  }

  /**
   * Block implementation: Make directory (delegates to 02-volumes.js)
   */
  makeDir(args) {
    return makeDirImpl(args);
  }

  /**
   * Block implementation: Delete directory (delegates to 02-volumes.js)
   */
  deleteDir(args) {
    return deleteDirImpl(args);
  }
}

// Register the extension
Scratch.extensions.register(new VolumesExtension());
