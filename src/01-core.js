class CobaltVDisk {
  constructor() {
    this.diskImageFolder = 'cobaltvdisk-image';
    this.metadataFile = '.cobaltvdisk-meta.json';
    this.defaultDirectoryMode = 0o755;
    this.defaultFileMode = 0o644;

    this.mounted = false;
    this.useMemoryBackend = false;
    this.opfsRootHandle = null;
    this.memoryRoot = this._createMemoryDirectoryNode();
    this.metadata = {
      '/': {
        type: 'directory',
        mode: this.defaultDirectoryMode,
      },
    };
  }

  getInfo() {
    return {
      id: 'cobaltVDisk',
      name: Scratch.translate('CobaltVDisk'),
      color1: '#007BFF',
      color2: '#0069d9',
      color3: '#005cbf',
      menuIconURI: mint.assets.get('icons/menu.png') ?? '',
      blockIconURI: mint.assets.get('icons/block.png') ?? '',
      blocks: [
        {
          opcode: 'mountVDisk',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('mount VDisk'),
        },
        {
          opcode: 'createFile',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('create file at path [PATH] with content [DATA]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
            DATA: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'Hello, CobaltVDisk!',
            },
          },
        },
        {
          opcode: 'readFile',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('read file at path [PATH]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
          },
        },
        {
          opcode: 'writeFile',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('append/write [DATA] to file at path [PATH] as [MODE]'),
          arguments: {
            DATA: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'More data',
            },
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
            MODE: {
              type: Scratch.ArgumentType.STRING,
              menu: 'WRITE_MODE',
            },
          },
        },
        {
          opcode: 'removePath',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('remove file or directory at path [PATH]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
          },
        },
        {
          opcode: 'createDirectory',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('create directory [PATH]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes',
            },
          },
        },
        {
          opcode: 'listContents',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('list contents of [PATH]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/',
            },
          },
        },
        {
          opcode: 'getFileSize',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('get file size of [PATH]'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
          },
        },
        {
          opcode: 'pathExists',
          blockType: Scratch.BlockType.BOOLEAN,
          text: Scratch.translate('does path [PATH] exist?'),
          arguments: {
            PATH: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '/notes/hello.txt',
            },
          },
        },
      ],
      menus: {
        WRITE_MODE: {
          acceptReporters: true,
          items: ['write', 'append'],
        },
      },
    };
  }

  async mountVDisk() {
    await this._mount();
  }

  async createFile(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return;
    }
    try {
      await this._mount();
      const parentPath = this._parentPath(path);
      if (!parentPath) {
        return;
      }
      await this._ensureDirectory(parentPath, false);
      await this._writeFile(path, String(args.DATA ?? ''), false);
      this._setMetadata(path, {
        type: 'file',
        mode: this.defaultFileMode,
      });
      await this._saveMetadata();
    } catch {
      // Ignore command errors in Scratch command blocks.
    }
  }

  async readFile(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return '';
    }
    try {
      await this._mount();
      return await this._readFile(path);
    } catch {
      return '';
    }
  }

  async writeFile(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return;
    }
    const mode = String(args.MODE || 'write').toLowerCase() === 'append' ? 'append' : 'write';
    try {
      await this._mount();
      const parentPath = this._parentPath(path);
      if (!parentPath) {
        return;
      }
      await this._ensureDirectory(parentPath, false);
      await this._writeFile(path, String(args.DATA ?? ''), mode === 'append');
      this._setMetadata(path, {
        type: 'file',
        mode: this.defaultFileMode,
      });
      await this._saveMetadata();
    } catch {
      // Ignore command errors in Scratch command blocks.
    }
  }

  async removePath(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return;
    }
    try {
      await this._mount();
      await this._removePath(path);
      this._removeMetadata(path);
      await this._saveMetadata();
    } catch {
      // Ignore command errors in Scratch command blocks.
    }
  }

  async createDirectory(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return;
    }
    try {
      await this._mount();
      await this._ensureDirectory(path, true);
      this._setMetadata(path, {
        type: 'directory',
        mode: this.defaultDirectoryMode,
      });
      await this._saveMetadata();
    } catch {
      // Ignore command errors in Scratch command blocks.
    }
  }

  async listContents(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: true });
    if (!path) {
      return '';
    }
    try {
      await this._mount();
      const entries = await this._listDirectory(path);
      return JSON.stringify(entries);
    } catch {
      return '';
    }
  }

  async getFileSize(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: false });
    if (!path) {
      return 0;
    }
    try {
      await this._mount();
      return await this._fileSize(path);
    } catch {
      return 0;
    }
  }

  async pathExists(args) {
    const path = this._normalizePath(args.PATH, { allowRoot: true });
    if (!path) {
      return false;
    }
    try {
      await this._mount();
      return await this._exists(path);
    } catch {
      return false;
    }
  }

  async _mount() {
    if (this.mounted) {
      return;
    }

    if (this._supportsOpfs()) {
      try {
        const originRoot = await navigator.storage.getDirectory();
        this.opfsRootHandle = await originRoot.getDirectoryHandle(this.diskImageFolder, { create: true });
        this.useMemoryBackend = false;
        await this._loadMetadata();
        this.mounted = true;
        return;
      } catch {
        // If OPFS is unavailable in the current runtime (e.g. Node tests), fallback.
      }
    }

    this.useMemoryBackend = true;
    this.memoryRoot = this._createMemoryDirectoryNode();
    this.metadata = {
      '/': {
        type: 'directory',
        mode: this.defaultDirectoryMode,
      },
    };
    this.mounted = true;
  }

  _supportsOpfs() {
    return (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  _normalizePath(rawPath, options = {}) {
    const allowRoot = options.allowRoot !== false;
    const raw = String(rawPath ?? '').trim();
    const withRoot = raw.startsWith('/') ? raw : `/${raw}`;
    const segments = withRoot.split('/');
    const normalized = [];

    for (const segment of segments) {
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (normalized.length > 0) {
          normalized.pop();
        }
        continue;
      }
      normalized.push(segment);
    }

    const normalizedPath = `/${normalized.join('/')}`;
    if (normalizedPath === '/' && !allowRoot) {
      return '';
    }
    return normalizedPath;
  }

  _parentPath(path) {
    if (path === '/') {
      return '';
    }
    const index = path.lastIndexOf('/');
    if (index <= 0) {
      return '/';
    }
    return path.slice(0, index);
  }

  _baseName(path) {
    const index = path.lastIndexOf('/');
    if (index < 0) {
      return path;
    }
    return path.slice(index + 1);
  }

  _segments(path) {
    if (path === '/') {
      return [];
    }
    return path.split('/').filter(Boolean);
  }

  async _loadMetadata() {
    if (this.useMemoryBackend || !this.opfsRootHandle) {
      return;
    }
    try {
      const fileHandle = await this.opfsRootHandle.getFileHandle(this.metadataFile);
      const file = await fileHandle.getFile();
      const content = await file.text();
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        this.metadata = parsed;
      }
    } catch {
      this.metadata = {
        '/': {
          type: 'directory',
          mode: this.defaultDirectoryMode,
        },
      };
    }

    if (!this.metadata['/']) {
      this.metadata['/'] = {
        type: 'directory',
        mode: this.defaultDirectoryMode,
      };
    }
  }

  async _saveMetadata() {
    if (this.useMemoryBackend || !this.opfsRootHandle) {
      return;
    }
    const fileHandle = await this.opfsRootHandle.getFileHandle(this.metadataFile, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(this.metadata));
    await writable.close();
  }

  _setMetadata(path, entry) {
    this.metadata[path] = entry;
  }

  _removeMetadata(path) {
    for (const key of Object.keys(this.metadata)) {
      if (key === path || key.startsWith(`${path}/`)) {
        delete this.metadata[key];
      }
    }
  }

  _createMemoryDirectoryNode() {
    return {
      type: 'directory',
      mode: this.defaultDirectoryMode,
      children: {},
    };
  }

  _createMemoryFileNode(content) {
    return {
      type: 'file',
      mode: this.defaultFileMode,
      content: String(content),
    };
  }

  _getMemoryNode(path) {
    const segments = this._segments(path);
    let node = this.memoryRoot;
    for (const segment of segments) {
      if (!node || node.type !== 'directory') {
        return null;
      }
      node = node.children[segment];
      if (!node) {
        return null;
      }
    }
    return node;
  }

  _getMemoryParent(path) {
    const parentPath = this._parentPath(path);
    if (!parentPath) {
      return null;
    }
    const parentNode = this._getMemoryNode(parentPath);
    const name = this._baseName(path);
    if (!name) {
      return null;
    }
    return { parentNode, name };
  }

  async _ensureDirectory(path, createParents) {
    if (path === '/') {
      return;
    }

    if (this.useMemoryBackend) {
      const segments = this._segments(path);
      let node = this.memoryRoot;
      let builtPath = '';
      for (const segment of segments) {
        builtPath = `${builtPath}/${segment}`;
        const existing = node.children[segment];
        if (existing) {
          if (existing.type !== 'directory') {
            throw new Error('Not a directory');
          }
          node = existing;
          continue;
        }
        if (!createParents && builtPath !== path) {
          throw new Error('Parent directory missing');
        }
        node.children[segment] = this._createMemoryDirectoryNode();
        node = node.children[segment];
        this._setMetadata(builtPath, {
          type: 'directory',
          mode: this.defaultDirectoryMode,
        });
      }
      return;
    }

    const segments = this._segments(path);
    let directory = this.opfsRootHandle;
    let builtPath = '';
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLeaf = index === segments.length - 1;
      builtPath = `${builtPath}/${segment}`;
      const allowCreate = createParents || isLeaf;
      directory = await directory.getDirectoryHandle(segment, { create: allowCreate });
      this._setMetadata(builtPath, {
        type: 'directory',
        mode: this.defaultDirectoryMode,
      });
    }
  }

  async _writeFile(path, data, appendMode) {
    if (this.useMemoryBackend) {
      const parentInfo = this._getMemoryParent(path);
      if (!parentInfo || !parentInfo.parentNode || parentInfo.parentNode.type !== 'directory') {
        throw new Error('Missing parent directory');
      }
      const existing = parentInfo.parentNode.children[parentInfo.name];
      if (existing && existing.type !== 'file') {
        throw new Error('Path is not a file');
      }
      if (!existing) {
        parentInfo.parentNode.children[parentInfo.name] = this._createMemoryFileNode('');
      }
      const fileNode = parentInfo.parentNode.children[parentInfo.name];
      fileNode.content = appendMode ? `${fileNode.content}${data}` : data;
      return;
    }

    const parentPath = this._parentPath(path);
    const fileName = this._baseName(path);
    const parentDirectory = await this._getOpfsDirectory(path === '/' ? '/' : parentPath);
    const fileHandle = await parentDirectory.getFileHandle(fileName, { create: true });
    const currentFile = await fileHandle.getFile();
    const writable = await fileHandle.createWritable();
    if (appendMode) {
      await writable.write({
        type: 'write',
        position: currentFile.size,
        data,
      });
    } else {
      await writable.write(data);
    }
    await writable.close();
  }

  async _readFile(path) {
    if (this.useMemoryBackend) {
      const node = this._getMemoryNode(path);
      if (!node || node.type !== 'file') {
        throw new Error('File not found');
      }
      return node.content;
    }

    const parentPath = this._parentPath(path);
    const fileName = this._baseName(path);
    const parentDirectory = await this._getOpfsDirectory(path === '/' ? '/' : parentPath);
    const fileHandle = await parentDirectory.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return await file.text();
  }

  async _removePath(path) {
    if (this.useMemoryBackend) {
      const parentInfo = this._getMemoryParent(path);
      if (!parentInfo || !parentInfo.parentNode || parentInfo.parentNode.type !== 'directory') {
        return;
      }
      delete parentInfo.parentNode.children[parentInfo.name];
      return;
    }

    const parentPath = this._parentPath(path);
    const name = this._baseName(path);
    const parentDirectory = await this._getOpfsDirectory(path === '/' ? '/' : parentPath);
    await parentDirectory.removeEntry(name, { recursive: true });
  }

  async _listDirectory(path) {
    if (this.useMemoryBackend) {
      const node = this._getMemoryNode(path);
      if (!node || node.type !== 'directory') {
        throw new Error('Directory not found');
      }
      return Object.keys(node.children).sort();
    }

    const directory = await this._getOpfsDirectory(path);
    const result = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const [name] of directory.entries()) {
      if (name !== this.metadataFile) {
        result.push(name);
      }
    }
    result.sort();
    return result;
  }

  async _fileSize(path) {
    if (this.useMemoryBackend) {
      const node = this._getMemoryNode(path);
      if (!node || node.type !== 'file') {
        throw new Error('File not found');
      }
      return node.content.length;
    }

    const parentPath = this._parentPath(path);
    const fileName = this._baseName(path);
    const parentDirectory = await this._getOpfsDirectory(path === '/' ? '/' : parentPath);
    const fileHandle = await parentDirectory.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return file.size;
  }

  async _exists(path) {
    if (path === '/') {
      return true;
    }

    if (this.useMemoryBackend) {
      return this._getMemoryNode(path) !== null;
    }

    try {
      const parentPath = this._parentPath(path);
      const name = this._baseName(path);
      const parentDirectory = await this._getOpfsDirectory(path === '/' ? '/' : parentPath);
      try {
        await parentDirectory.getFileHandle(name);
        return true;
      } catch {
        await parentDirectory.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }

  async _getOpfsDirectory(path) {
    const segments = this._segments(path);
    let directory = this.opfsRootHandle;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }
    return directory;
  }
}

Scratch.extensions.register(new CobaltVDisk());
