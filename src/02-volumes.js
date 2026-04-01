/**
 * Volumes — OPFS implementation helpers
 *
 * Each exported function corresponds to a block in VolumesExtension (01-core.js).
 * All functions operate on the browser's Origin Private File System (OPFS) via
 * the navigator.storage.getDirectory() API and therefore return Promises.
 *
 * Error handling strategy:
 *   - Read/existence operations silently return a safe default on failure.
 *   - Write/delete operations silently ignore errors so blocks never throw.
 */

/**
 * Resolve a path string to a { dir, name } pair where `dir` is the parent
 * FileSystemDirectoryHandle and `name` is the final path component.
 *
 * @param {string} rawPath  POSIX-style path relative to the OPFS root.
 * @param {boolean} [create=false]  When true, create missing intermediate directories.
 * @returns {Promise<{ dir: FileSystemDirectoryHandle, name: string }>}
 */
async function resolvePath(rawPath, create = false) {
  const root = await navigator.storage.getDirectory();
  const parts = String(rawPath)
    .replace(/\\/g, '/')
    .split('/')
    .filter(p => p.length > 0);

  if (parts.length === 0) {
    throw new Error('Path must contain at least one name component.');
  }

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create });
  }

  return { dir, name: parts[parts.length - 1] };
}

/**
 * Write text content to a file at the given OPFS path.
 * Intermediate directories are created automatically.
 *
 * @param {{ PATH: string, CONTENT: string }} args
 * @returns {Promise<void>}
 */
export async function writeFileImpl(args) {
  const { dir, name } = await resolvePath(String(args.PATH), true);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(String(args.CONTENT));
  await writable.close();
}

/**
 * Read text content from a file at the given OPFS path.
 * Returns an empty string if the file does not exist or cannot be read.
 *
 * @param {{ PATH: string }} args
 * @returns {Promise<string>}
 */
export async function readFileImpl(args) {
  try {
    const { dir, name } = await resolvePath(String(args.PATH));
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (_e) {
    return '';
  }
}

/**
 * Delete a file at the given OPFS path.
 * Silently ignores errors when the file does not exist.
 *
 * @param {{ PATH: string }} args
 * @returns {Promise<void>}
 */
export async function deleteFileImpl(args) {
  try {
    const { dir, name } = await resolvePath(String(args.PATH));
    await dir.removeEntry(name);
  } catch (_e) {
    // Ignore errors if the file does not exist
  }
}

/**
 * Check whether a file exists at the given OPFS path.
 *
 * @param {{ PATH: string }} args
 * @returns {Promise<boolean>}
 */
export async function fileExistsImpl(args) {
  try {
    const { dir, name } = await resolvePath(String(args.PATH));
    await dir.getFileHandle(name);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * List all entry names (files and subdirectories) inside a directory.
 * Returns a JSON-encoded, alphabetically sorted array of entry names.
 * Returns '[]' if the directory does not exist or cannot be read.
 *
 * @param {{ DIR: string }} args
 * @returns {Promise<string>}  e.g. '["a.txt","subdir"]'
 */
export async function listFilesImpl(args) {
  try {
    const root = await navigator.storage.getDirectory();
    const dirPath = String(args.DIR).replace(/\\/g, '/');
    let dir;
    if (dirPath === '' || dirPath === '/') {
      dir = root;
    } else {
      const { dir: parent, name } = await resolvePath(dirPath);
      dir = await parent.getDirectoryHandle(name);
    }
    const names = [];
    for await (const key of dir.keys()) {
      names.push(key);
    }
    return JSON.stringify(names.sort());
  } catch (_e) {
    return '[]';
  }
}

/**
 * Create a directory (and all intermediate directories) at the given OPFS path.
 * Silently ignores errors if the directory already exists.
 *
 * @param {{ DIR: string }} args
 * @returns {Promise<void>}
 */
export async function makeDirImpl(args) {
  try {
    const root = await navigator.storage.getDirectory();
    const parts = String(args.DIR)
      .replace(/\\/g, '/')
      .split('/')
      .filter(p => p.length > 0);
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  } catch (_e) {
    // Ignore errors
  }
}

/**
 * Recursively delete a directory and all its contents at the given OPFS path.
 * Silently ignores errors if the directory does not exist.
 *
 * @param {{ DIR: string }} args
 * @returns {Promise<void>}
 */
export async function deleteDirImpl(args) {
  try {
    const { dir, name } = await resolvePath(String(args.DIR));
    await dir.removeEntry(name, { recursive: true });
  } catch (_e) {
    // Ignore errors if the directory does not exist
  }
}
