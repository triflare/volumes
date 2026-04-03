class triflareVolumes {
  /* global __ASSET__ */

  constructor() {
    this.volumes = {};
    this.lastError = JSON.stringify({ status: 'success' });
    // Toggle verbose logging for Volumes (no-op when false)
    this.VolumesLogEnabled = false;

    // Internal metadata storage for OPFS MIME sidecars
    this._opfsMeta = new Map(); // Maps volName:relPath -> mime string
    // Internal storage for Permissions
    this._opfsPerms = new Map(); // Maps volName:relPath -> perms object
    // Memoization cache for fast path parsing
    this._pathCache = new Map();

    this._ready = this._initVolumes().catch(e => {
      this.lastError = JSON.stringify({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to initialize volumes: ' + (e.message || String(e)),
      });
      this._warn('Volumes initialization failed:', e);
    });
  }

  getInfo() {
    return {
      id: 'triflareVolumes',
      name: Scratch.translate('Volumes'),
      menuIconURI: __ASSET__('icon.svg'),
      color1: '#63cf7a',
      color2: '#42bd5b',
      blocks: [
        {
          opcode: 'mountAs',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('mount [VOL] as [TYPE]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'myfs://' },
            TYPE: { type: Scratch.ArgumentType.STRING, menu: 'volTypes' },
          },
        },
        {
          opcode: 'formatVolume',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('format volume [VOL]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'listVolumes',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('list mounted volumes'),
          disableMonitor: false,
        },
        {
          opcode: 'setSizeLimit',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('set size limit of [VOL] to [LIMIT] bytes'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
            LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10485760 },
          },
        },
        {
          opcode: 'setFileCountLimit',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('set file count limit of [VOL] to [LIMIT]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
            LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10000 },
          },
        },

        // --- File Operations ---
        { blockType: Scratch.BlockType.LABEL, text: Scratch.translate('File Operations') },
        {
          opcode: 'fileWrite',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('[MODE] [STRING] to [PATH]'),
          arguments: {
            MODE: { type: Scratch.ArgumentType.STRING, menu: 'writeMode' },
            STRING: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello World' },
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
          },
        },
        {
          opcode: 'fileRead',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('read [PATH] as [FORMAT]'),
          arguments: {
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
            FORMAT: { type: Scratch.ArgumentType.STRING, menu: 'readFormat' },
          },
        },
        {
          opcode: 'deletePath',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('delete [PATH]'),
          arguments: {
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
          },
        },

        // --- Path & Directory ---
        { blockType: Scratch.BlockType.LABEL, text: Scratch.translate('Path & Directory') },
        {
          opcode: 'listFiles',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('list [DEPTH] files in [PATH]'),
          arguments: {
            DEPTH: { type: Scratch.ArgumentType.STRING, menu: 'listDepth' },
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'pathCheck',
          blockType: Scratch.BlockType.BOOLEAN,
          text: Scratch.translate('[PATH] [CONDITION]?'),
          arguments: {
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
            CONDITION: { type: Scratch.ArgumentType.STRING, menu: 'pathCondition' },
          },
        },
        {
          opcode: 'joinPaths',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('join path [P1] and [P2]'),
          arguments: {
            P1: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://folder' },
            P2: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.txt' },
          },
        },

        // --- Permissions ---
        { blockType: Scratch.BlockType.LABEL, text: Scratch.translate('Permissions') },
        {
          opcode: 'setPermission',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('set [PERM] permission of [PATH] to [VALUE]'),
          arguments: {
            PERM: { type: Scratch.ArgumentType.STRING, menu: 'permissionTypes' },
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
            VALUE: { type: Scratch.ArgumentType.STRING, menu: 'permissionValues' },
          },
        },
        {
          opcode: 'checkPermission',
          blockType: Scratch.BlockType.BOOLEAN,
          text: Scratch.translate('[PATH] allows [PERM]?'),
          arguments: {
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://test.txt' },
            PERM: { type: Scratch.ArgumentType.STRING, menu: 'permissionTypes' },
          },
        },

        // --- Import & Export ---
        { blockType: Scratch.BlockType.LABEL, text: Scratch.translate('Import & Export') },
        {
          opcode: 'exportVolume',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('export [VOL] as JSON'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'importVolume',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('import JSON [JSON] to [VOL]'),
          arguments: {
            JSON: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },

        // --- Diagnostics ---
        { blockType: Scratch.BlockType.LABEL, text: Scratch.translate('Diagnostics') },
        {
          opcode: 'getLastError',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('last error'),
          disableMonitor: false,
        },
        {
          opcode: 'runIntegrityTest',
          blockType: Scratch.BlockType.REPORTER,
          text: Scratch.translate('run integrity test'),
          disableMonitor: false,
        },
      ],
      menus: {
        volTypes: { acceptReporters: true, items: ['OPFS', 'RAM'] },
        writeMode: { acceptReporters: true, items: ['write', 'append'] },
        readFormat: { acceptReporters: true, items: ['text', 'Data URI'] },
        pathCondition: { acceptReporters: true, items: ['exists', 'is a directory'] },
        listDepth: { acceptReporters: true, items: ['immediate', 'all'] },
        permissionTypes: {
          acceptReporters: true,
          items: ['read', 'write', 'create', 'view', 'delete', 'control'],
        },
        permissionValues: { acceptReporters: true, items: ['allow', 'deny'] },
      },
    };
  }

  // --- Core Initialization ---
  async _initVolumes() {
    const defaultPerms = {
      read: true,
      write: true,
      create: true,
      view: true,
      delete: true,
      control: true,
    };
    this.volumes['tmp://'] = {
      type: 'RAM',
      root: this._createRAMNode('dir'),
      sizeLimit: 10 * 1024 * 1024, // 10MB Default
      fileCountLimit: 10000,
      size: 0,
      fileCount: 0,
      perms: { ...defaultPerms },
    };

    if (this._supportsOPFS()) {
      try {
        const root = await this._getOPFSRoot();
        const fsHandle = await root.getDirectoryHandle('fs', { create: true });
        const { size, count } = await this._getDirectoryStats(fsHandle);
        this.volumes['fs://'] = {
          type: 'OPFS',
          sizeLimit: Infinity,
          fileCountLimit: Infinity,
          size: size,
          fileCount: count,
          perms: { ...defaultPerms },
        };

        // Restore persisted metadata and permissions
        await this._restoreOPFSMetadata('fs://');
      } catch (e) {
        this._warn('OPFS failed to initialize fs://', e);
        // Surface initialization failure to constructor-level by rethrowing so
        // the _ready promise rejects and callers see the error state.
        throw e;
      }
    }
  }

  // --- Utility Functions ---
  _supportsOPFS() {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  async _getOPFSRoot() {
    if (!this._supportsOPFS()) {
      throw new Error('INTERNAL_ERROR: OPFS unsupported');
    }

    return navigator.storage.getDirectory();
  }

  _handleError(e) {
    let code = 'INTERNAL_ERROR';
    const message = e.message || String(e);

    if (message.includes('NOT_FOUND') || e.name === 'NotFoundError') code = 'NOT_FOUND';
    else if (message.includes('TYPE_MISMATCH') || e.name === 'TypeMismatchError')
      code = 'TYPE_MISMATCH';
    else if (message.includes('QUOTA_EXCEEDED') || e.name === 'QuotaExceededError')
      code = 'QUOTA_EXCEEDED';
    else if (message.includes('INVALID_PATH') || message.includes('INVALID_ARGUMENT'))
      code = 'INVALID_ARGUMENT';
    else if (
      message.includes('PERMISSION_DENIED') ||
      e.name === 'NotAllowedError' ||
      e.name === 'SecurityError'
    )
      code = 'PERMISSION_DENIED';

    const errObj = {
      status: 'error',
      code: code,
      message: message.replace(
        /^(NOT_FOUND|TYPE_MISMATCH|QUOTA_EXCEEDED|INVALID_PATH|INVALID_ARGUMENT|PERMISSION_DENIED):\s*/,
        ''
      ),
    };
    this.lastError = JSON.stringify(errObj);
    // Route errors through gated logging helpers instead of direct console output
    this._warn('Volumes error:', errObj);
    return this.lastError;
  }

  _log(...args) {
    if (!this.VolumesLogEnabled) return;

    console.log(...args);
  }

  _warn(...args) {
    if (!this.VolumesLogEnabled) return;

    console.warn(...args);
  }

  _parse(pathStr) {
    if (this._pathCache.has(pathStr)) {
      const cached = this._pathCache.get(pathStr);
      if (!this.volumes[cached.volName])
        throw new Error(`NOT_FOUND: Volume ${cached.volName} does not exist`);
      return {
        volName: cached.volName,
        relPath: cached.relPath,
        vol: this.volumes[cached.volName],
      };
    }

    const parts = pathStr.split('://');
    if (parts.length < 2) throw new Error("INVALID_PATH: Missing volume separator '://'");
    const volName = parts[0] + '://';
    const relPath = parts.slice(1).join('://').replace(/\/+$/, '').replace(/^\/+/, '');

    // Forbid access to reserved metadata namespace
    if (relPath === '.kx_metadata' || relPath.startsWith('.kx_metadata/')) {
      throw new Error('FORBIDDEN: Access to reserved path .kx_metadata');
    }

    // Manage cache size to prevent memory leaks over long sessions
    if (this._pathCache.size > 512) this._pathCache.clear();
    this._pathCache.set(pathStr, { volName, relPath });

    if (!this.volumes[volName]) throw new Error(`NOT_FOUND: Volume ${volName} does not exist`);
    return { volName, relPath, vol: this.volumes[volName] };
  }

  _parseDataOrString(input) {
    const str = String(input);
    if (str.startsWith('data:')) {
      const commaIdx = str.indexOf(',');
      if (commaIdx >= 5) {
        const header = str.slice(5, commaIdx);
        const dataStr = str.slice(commaIdx + 1);
        const isBase64 = header.endsWith(';base64');
        const mime = isBase64 ? header.slice(0, -7) : header;
        const finalMime = mime || 'text/plain';
        if (isBase64) {
          return { mime: finalMime, dataBuf: this._base64ToUint8Array(dataStr) };
        } else {
          return {
            mime: finalMime,
            dataBuf: new TextEncoder().encode(decodeURIComponent(dataStr)),
          };
        }
      }
    }
    return { mime: 'text/plain', dataBuf: new TextEncoder().encode(str) };
  }

  _base64ToUint8Array(base64) {
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
    return bytes;
  }

  _uint8ArrayToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32KB chunks
    const chunks = [];
    for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
    }
    return btoa(chunks.join(''));
  }

  // --- Permission Engine ---
  _getPerms(volName, relPath) {
    const defaultPerms = {
      read: true,
      write: true,
      create: true,
      view: true,
      delete: true,
      control: true,
    };
    if (!relPath) {
      const vol = this.volumes[volName];
      // Prefer persisted OPFS root permissions when available so remounts
      // observe the same root policy.
      const metaKey = `${volName}`;
      const rootPerms = this._opfsPerms.get(metaKey);
      if (rootPerms) return rootPerms;
      if (!vol.perms) vol.perms = { ...defaultPerms };
      return vol.perms;
    }
    if (this.volumes[volName].type === 'RAM') {
      try {
        const node = this._traverseRAM(volName, relPath);
        return node.perms || { ...defaultPerms };
      } catch (_e) {
        return { ...defaultPerms };
      }
    } else {
      const metaKey = `${volName}${relPath}`;
      return this._opfsPerms.get(metaKey) || { ...defaultPerms };
    }
  }

  _setPerm(volName, relPath, permType, value) {
    const validPerms = ['read', 'write', 'create', 'view', 'delete', 'control'];
    if (!validPerms.includes(permType)) {
      throw new Error('INVALID_ARGUMENT: Invalid permission type');
    }

    const perms = this._getPerms(volName, relPath);
    // Safe to set because permType is validated against an allowlist
    perms[permType] = value;

    if (!relPath) {
      this.volumes[volName].perms = perms;
      // Also ensure root perms are reflected in OPFS-perms map so they get persisted
      if (this.volumes[volName].type === 'OPFS') {
        const metaKey = volName;
        this._opfsPerms.set(metaKey, perms);
      }
    } else if (this.volumes[volName].type === 'RAM') {
      const node = this._traverseRAM(volName, relPath);
      node.perms = perms;
    } else {
      const metaKey = `${volName}${relPath}`;
      this._opfsPerms.set(metaKey, perms);
    }

    // Persist metadata and await it so callers see durable state. Serialize
    // concurrent persists per-volume using a per-volume promise chain.
    if (this.volumes[volName] && this.volumes[volName].type === 'OPFS') {
      this._opfsPersistPromises = this._opfsPersistPromises || {};
      const prev = this._opfsPersistPromises[volName] || Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(() => this._persistOPFSMetadata(volName))
        .finally(() => {
          // Clean up stale entries if volume no longer exists or is no longer OPFS
          if (!this.volumes[volName] || this.volumes[volName].type !== 'OPFS') {
            delete this._opfsPersistPromises[volName];
          }
        });
      this._opfsPersistPromises[volName] = next;
      return next;
    }

    return Promise.resolve();
  }

  // --- RAM Engine ---
  _createRAMNode(type, mime = 'text/plain') {
    return {
      type: type,
      children: type === 'dir' ? new Map() : null,
      content: type === 'file' ? new Uint8Array(0) : null,
      mime: mime,
      perms: { read: true, write: true, create: true, view: true, delete: true, control: true },
    };
  }

  _traverseRAM(volName, path, options = {}) {
    const vol = this.volumes[volName];
    let current = vol.root;
    const parts = path.split('/').filter(p => p);

    if (parts.length === 0) {
      if (options.parentOnly) throw new Error('INVALID_PATH: Root has no parent');
      return current;
    }

    const targetLen = options.parentOnly ? parts.length - 1 : parts.length;

    for (let i = 0; i < targetLen; i++) {
      const part = parts[i];
      if (current.type !== 'dir')
        throw new Error(`TYPE_MISMATCH: ${parts.slice(0, i).join('/') || '/'} is not a directory`);

      if (!current.children.has(part)) {
        if (options.createDirs) {
          const currentRelPath = parts.slice(0, i).join('/');
          if (!this._getPerms(volName, currentRelPath).create) {
            throw new Error(
              'PERMISSION_DENIED: Create permission denied on ' + (currentRelPath || 'root')
            );
          }
          current.children.set(part, this._createRAMNode('dir'));
          // Directories don't count towards file limit, but keeping it structurally sound
        } else {
          throw new Error(`NOT_FOUND: Path ${part} does not exist`);
        }
      }
      current = current.children.get(part);
    }

    if (options.parentOnly) {
      if (current.type !== 'dir')
        throw new Error(
          `TYPE_MISMATCH: ${parts.slice(0, parts.length - 1).join('/') || '/'} is not a directory`
        );
      return { parent: current, name: parts[parts.length - 1] };
    }
    return current;
  }

  async _getRAMNodeStats(node) {
    if (node.type === 'file') return { size: node.content.byteLength, count: 1 };
    let size = 0;
    let count = 0;
    for (const child of node.children.values()) {
      const stats = await this._getRAMNodeStats(child);
      size += stats.size;
      count += stats.count;
    }
    return { size, count };
  }

  // --- OPFS Metadata Persistence ---
  async _persistOPFSMetadata(volName) {
    // Only persist for OPFS volumes
    if (!this.volumes[volName] || this.volumes[volName].type !== 'OPFS') return;

    const root = await this._getOPFSRoot();
    const dirName = volName.replace('://', '');
    const volHandle = await root.getDirectoryHandle(dirName, { create: true });

    // Serialize metadata maps for this volume
    const metaEntries = [];
    const permEntries = [];

    for (const [key, value] of this._opfsMeta.entries()) {
      if (key.startsWith(volName)) {
        metaEntries.push([key, value]);
      }
    }

    for (const [key, value] of this._opfsPerms.entries()) {
      if (key.startsWith(volName)) {
        permEntries.push([key, value]);
      }
    }

    const metadata = {
      meta: metaEntries,
      perms: permEntries,
    };

    // Store in a reserved metadata file
    const metaFileHandle = await volHandle.getFileHandle('.kx_metadata', { create: true });
    const writable = await metaFileHandle.createWritable();
    await writable.write(JSON.stringify(metadata));
    await writable.close();
  }

  async _restoreOPFSMetadata(volName) {
    // Only restore for OPFS volumes
    if (!this.volumes[volName] || this.volumes[volName].type !== 'OPFS') return;

    try {
      const root = await this._getOPFSRoot();
      const dirName = volName.replace('://', '');
      const volHandle = await root.getDirectoryHandle(dirName, { create: false });

      // Try to read the metadata file
      const metaFileHandle = await volHandle.getFileHandle('.kx_metadata', { create: false });
      const file = await metaFileHandle.getFile();
      const text = await file.text();
      const metadata = JSON.parse(text);

      // Restore metadata maps
      if (metadata.meta && Array.isArray(metadata.meta)) {
        for (const [key, value] of metadata.meta) {
          this._opfsMeta.set(key, value);
        }
      }

      if (metadata.perms && Array.isArray(metadata.perms)) {
        for (const [key, value] of metadata.perms) {
          this._opfsPerms.set(key, value);
          // Keep public volume root perms in sync so remounts/imports preserve them
          if (key === volName) {
            if (!this.volumes[volName]) {
              throw new Error(
                `INTERNAL_ERROR: Cannot restore permissions for unmounted volume ${volName}`
              );
            }
            this.volumes[volName].perms = value;
          }
        }
      }
    } catch (e) {
      // Metadata file may not exist yet, which is fine
      if (e.name !== 'NotFoundError') {
        this._warn('Failed to restore OPFS metadata for', volName, e);
      }
    }
  }

  // --- OPFS Engine ---
  async _getDirectoryStats(dirHandle) {
    let size = 0;
    let count = 0;
    for await (const entry of dirHandle.values()) {
      // Skip internal metadata sidecar so it doesn't inflate counts/sizes
      if (entry.name === '.kx_metadata') continue;

      if (entry.kind === 'file') {
        size += (await entry.getFile()).size;
        count += 1;
      } else if (entry.kind === 'directory') {
        const subStats = await this._getDirectoryStats(entry);
        size += subStats.size;
        count += subStats.count;
      }
    }
    return { size, count };
  }

  async _resolveOPFSNode(volName, relPath, options = {}) {
    const root = await this._getOPFSRoot();
    const dirName = volName.replace('://', '');
    let current = await root.getDirectoryHandle(dirName, { create: true });

    const parts = relPath.split('/').filter(p => p);
    if (parts.length === 0) return { handle: current, type: 'directory' };

    // Always traverse to the parent directory; parentOnly controls return shape
    const targetLen = parts.length - 1;

    for (let i = 0; i < targetLen; i++) {
      try {
        current = await current.getDirectoryHandle(parts[i], { create: false });
      } catch (_e) {
        if (_e.name === 'TypeMismatchError')
          throw new Error(`TYPE_MISMATCH: ${parts[i]} is not a directory`, { cause: _e });
        if (options.createDirs) {
          const currentRelPath = parts.slice(0, i).join('/');
          if (!this._getPerms(volName, currentRelPath).create) {
            throw new Error(
              'PERMISSION_DENIED: Create permission denied on ' + (currentRelPath || 'root'),
              { cause: _e }
            );
          }
          current = await current.getDirectoryHandle(parts[i], { create: true });
        } else {
          throw new Error(`NOT_FOUND: Directory ${parts[i]} not found`, { cause: _e });
        }
      }
    }

    const last = parts[parts.length - 1];
    if (options.parentOnly) return { parent: current, name: last };

    try {
      return { handle: await current.getFileHandle(last), type: 'file' };
    } catch (_e) {
      try {
        return {
          handle: await current.getDirectoryHandle(last, { create: !!options.createDirs }),
          type: 'directory',
        };
      } catch (_e2) {
        throw new Error(`NOT_FOUND: Path ${last} does not exist`, { cause: _e2 });
      }
    }
  }

  // --- Block Implementations ---

  joinPaths(args) {
    let p1 = String(args.P1);
    let p2 = String(args.P2);
    let protocol = '';

    if (p1.includes('://')) {
      const parts = p1.split('://');
      protocol = parts[0] + '://';
      p1 = parts.slice(1).join('://');
    }

    p1 = p1.replace(/\/+$/, '');
    p2 = p2.replace(/^\/+/, '');

    if (!p1) return protocol + p2;
    if (!p2) return protocol + p1;
    return protocol + p1 + '/' + p2;
  }

  async listVolumes() {
    await this._ready;
    return JSON.stringify(Object.keys(this.volumes));
  }

  async mountAs(args) {
    await this._ready;
    try {
      let volName = args.VOL.trim();
      if (!volName.endsWith('://')) volName += '://';
      const type = args.TYPE;
      const defaultPerms = {
        read: true,
        write: true,
        create: true,
        view: true,
        delete: true,
        control: true,
      };

      if (this.volumes[volName]) {
        if (this.volumes[volName].type !== type) {
          throw new Error(
            `TYPE_MISMATCH: Volume ${volName} already mounted as ${this.volumes[volName].type}`
          );
        }
        this.lastError = JSON.stringify({ status: 'success' });
        return this.lastError;
      }

      if (type === 'RAM') {
        this.volumes[volName] = {
          type: 'RAM',
          root: this._createRAMNode('dir'),
          sizeLimit: 10 * 1024 * 1024,
          fileCountLimit: 10000,
          size: 0,
          fileCount: 0,
          perms: { ...defaultPerms },
        };
      } else if (type === 'OPFS') {
        if (!this._supportsOPFS()) throw new Error('INTERNAL_ERROR: OPFS unsupported');
        const root = await this._getOPFSRoot();
        const dirName = volName.replace('://', '');
        const handle = await root.getDirectoryHandle(dirName, { create: true });
        const { size, count } = await this._getDirectoryStats(handle);
        this.volumes[volName] = {
          type: 'OPFS',
          sizeLimit: Infinity,
          fileCountLimit: Infinity,
          size: size,
          fileCount: count,
          perms: { ...defaultPerms },
        };
        // Restore persisted metadata and permissions
        await this._restoreOPFSMetadata(volName);
      } else {
        throw new Error('INVALID_ARGUMENT: Type must be RAM or OPFS');
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async setSizeLimit(args) {
    await this._ready;
    try {
      let volName = args.VOL.trim();
      if (!volName.endsWith('://')) volName += '://';
      const vol = this.volumes[volName];
      if (!vol) throw new Error('NOT_FOUND: Volume not found');

      // Require root control permission to change volume-wide quotas
      if (!this._getPerms(volName, '').control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      const newLimit = args.LIMIT === Infinity ? Infinity : Number(args.LIMIT);
      if ((newLimit !== Infinity && isNaN(newLimit)) || newLimit < 0)
        throw new Error('INVALID_ARGUMENT: Limit must be non-negative');
      vol.sizeLimit = newLimit;
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async setFileCountLimit(args) {
    await this._ready;
    try {
      let volName = args.VOL.trim();
      if (!volName.endsWith('://')) volName += '://';
      const vol = this.volumes[volName];
      if (!vol) throw new Error('NOT_FOUND: Volume not found');

      // Require root control permission to change volume-wide quotas
      if (!this._getPerms(volName, '').control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      const newLimit = args.LIMIT === Infinity ? Infinity : Number(args.LIMIT);
      if ((newLimit !== Infinity && isNaN(newLimit)) || newLimit < 0)
        throw new Error('INVALID_ARGUMENT: Limit must be non-negative');
      vol.fileCountLimit = newLimit;
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async formatVolume(args) {
    await this._ready;
    try {
      let volName = args.VOL.trim();
      if (!volName.endsWith('://')) volName += '://';
      const vol = this.volumes[volName];
      if (!vol) throw new Error('NOT_FOUND: Volume not found');

      // Align with setPermission root policy: formatting requires root control.
      if (!this._getPerms(volName, '').control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      if (vol.type === 'RAM') {
        vol.root = this._createRAMNode('dir');
        vol.size = 0;
        vol.fileCount = 0;
      } else {
        const root = await this._getOPFSRoot();
        const dirName = volName.replace('://', '');
        await root.removeEntry(dirName, { recursive: true });
        await root.getDirectoryHandle(dirName, { create: true });
        vol.size = 0;
        vol.fileCount = 0;

        for (const key of this._opfsMeta.keys())
          if (key.startsWith(volName)) this._opfsMeta.delete(key);
        for (const key of this._opfsPerms.keys())
          if (key.startsWith(volName)) this._opfsPerms.delete(key);

        // Clean up persist promise chain for formatted OPFS volume
        if (this._opfsPersistPromises && this._opfsPersistPromises[volName]) {
          delete this._opfsPersistPromises[volName];
        }
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async fileWrite(args) {
    if (args.MODE === 'append') return this._appendPath(args);
    return this._writePath(args);
  }

  async fileRead(args) {
    if (args.FORMAT === 'Data URI') return this._getDataURI(args);
    return this._readPath(args);
  }

  async pathCheck(args) {
    if (args.CONDITION === 'is a directory') return this._isDir(args);
    return this._exists(args);
  }

  // --- Read/Write Implementations ---

  async _writePath(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot write to root');
      const { mime, dataBuf } = this._parseDataOrString(args.STRING);

      if (vol.type === 'RAM') {
        const { parent, name } = this._traverseRAM(volName, relPath, {
          parentOnly: true,
          createDirs: true,
        });
        let existingSize = 0;
        let isNew = true;
        let existingPerms = null;

        if (parent.children.has(name)) {
          isNew = false;
          if (!this._getPerms(volName, relPath).write)
            throw new Error('PERMISSION_DENIED: Write permission denied');
          const existing = parent.children.get(name);
          if (existing.type === 'dir') throw new Error('TYPE_MISMATCH: Path is a directory');
          existingSize = existing.content.byteLength;
          existingPerms = existing.perms; // Preserve existing permissions
        } else {
          const parentRelPath = relPath.split('/').slice(0, -1).join('/');
          if (!this._getPerms(volName, parentRelPath).create)
            throw new Error('PERMISSION_DENIED: Create permission denied on parent directory');
          if (vol.fileCount + 1 > vol.fileCountLimit)
            throw new Error('QUOTA_EXCEEDED: File count limit reached');
        }

        const sizeDelta = dataBuf.byteLength - existingSize;
        if (vol.size + sizeDelta > vol.sizeLimit) throw new Error('QUOTA_EXCEEDED: Volume full');

        const node = this._createRAMNode('file', mime);
        node.content = dataBuf;
        // Restore existing permissions if overwriting
        if (existingPerms) {
          node.perms = existingPerms;
        }
        parent.children.set(name, node);
        vol.size += sizeDelta;
        if (isNew) vol.fileCount++;
      } else {
        // Serialize entire OPFS mutation per-volume to prevent races
        this._opfsPersistPromises = this._opfsPersistPromises || {};
        const prev = this._opfsPersistPromises[volName] || Promise.resolve();
        const next = prev
          .catch(() => {})
          .then(async () => {
            const { parent, name } = await this._resolveOPFSNode(volName, relPath, {
              parentOnly: true,
              createDirs: true,
            });
            let existingSize = 0;
            let isNew = false;
            try {
              existingSize = (await (await parent.getFileHandle(name)).getFile()).size;
            } catch (_e) {
              if (_e && _e.name === 'NotFoundError') {
                isNew = true;
              } else if (_e && _e.name === 'TypeMismatchError') {
                throw new Error('TYPE_MISMATCH: Path is a directory', { cause: _e });
              } else {
                throw _e;
              }
            }

            if (!isNew) {
              if (!this._getPerms(volName, relPath).write)
                throw new Error('PERMISSION_DENIED: Write permission denied');
            } else {
              const parentRelPath = relPath.split('/').slice(0, -1).join('/');
              if (!this._getPerms(volName, parentRelPath).create)
                throw new Error('PERMISSION_DENIED: Create permission denied on parent directory');
              if (vol.fileCount + 1 > vol.fileCountLimit)
                throw new Error('QUOTA_EXCEEDED: File count limit reached');
            }

            const sizeDelta = dataBuf.byteLength - existingSize;
            if (vol.size + sizeDelta > vol.sizeLimit) throw new Error('QUOTA_EXCEEDED: Volume full');

            // Narrow the try/catch to only the getFileHandle call which can throw a TypeMismatch for directories.
            let fh;
            try {
              fh = await parent.getFileHandle(name, { create: true });
            } catch (_e) {
              if (_e.name === 'TypeMismatchError')
                throw new Error('TYPE_MISMATCH: Target is likely a directory', { cause: _e });
              throw _e;
            }

            const writable = await fh.createWritable();
            await writable.write(dataBuf);
            await writable.close();

            const metaKey = `${volName}${relPath}`;
            this._opfsMeta.set(metaKey, mime);
            vol.size += sizeDelta;
            if (isNew) vol.fileCount++;

            // Persist metadata after write
            await this._persistOPFSMetadata(volName);
          })
          .finally(() => {
            if (this._opfsPersistPromises[volName] === next) {
              delete this._opfsPersistPromises[volName];
            }
          });
        this._opfsPersistPromises[volName] = next;
        await next;
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async _appendPath(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot append to root');
      const { dataBuf } = this._parseDataOrString(args.STRING);

      if (vol.type === 'RAM') {
        const { parent, name } = this._traverseRAM(volName, relPath, {
          parentOnly: true,
          createDirs: true,
        });
        if (!parent.children.has(name)) return this._writePath(args); // Fallbacks to checking Create permission

        if (!this._getPerms(volName, relPath).write)
          throw new Error('PERMISSION_DENIED: Write permission denied');

        const node = parent.children.get(name);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        if (vol.size + dataBuf.byteLength > vol.sizeLimit) throw new Error('QUOTA_EXCEEDED: Volume full');

        const newBuf = new Uint8Array(node.content.byteLength + dataBuf.byteLength);
        newBuf.set(node.content);
        newBuf.set(dataBuf, node.content.byteLength);
        node.content = newBuf;
        vol.size += dataBuf.byteLength;
      } else {
        let parent, name;
        try {
          ({ parent, name } = await this._resolveOPFSNode(volName, relPath, {
            parentOnly: true,
            createDirs: true,
          }));
        } catch (_e) {
          // Only fall back to _writePath for not-found errors; rethrow everything else
          if (
            _e &&
            (_e.name === 'NotFoundError' || (_e.message && _e.message.includes('NOT_FOUND')))
          ) {
            return this._writePath(args);
          }
          throw _e;
        }
        let fh;
        try {
          fh = await parent.getFileHandle(name);
        } catch (_e) {
          if (_e && _e.name === 'NotFoundError') return this._writePath(args);
          if (_e && _e.name === 'TypeMismatchError')
            throw new Error('TYPE_MISMATCH: Path is a directory', { cause: _e });
          throw _e;
        }

        if (!this._getPerms(volName, relPath).write)
          throw new Error('PERMISSION_DENIED: Write permission denied');

        const file = await fh.getFile();
        if (vol.size + dataBuf.byteLength > vol.sizeLimit) throw new Error('QUOTA_EXCEEDED: Volume full');

        const writable = await fh.createWritable({ keepExistingData: true });
        await writable.write({ type: 'write', data: dataBuf, position: file.size });
        await writable.close();
        vol.size += dataBuf.byteLength;
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async _readPath(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot read directory');
      if (!this._getPerms(volName, relPath).read)
        throw new Error('PERMISSION_DENIED: Read permission denied');

      if (vol.type === 'RAM') {
        const node = this._traverseRAM(volName, relPath);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        this.lastError = JSON.stringify({ status: 'success' });
        return new TextDecoder().decode(node.content);
      } else {
        const { handle, type } = await this._resolveOPFSNode(volName, relPath);
        if (type === 'directory') throw new Error('TYPE_MISMATCH: Is a directory');
        this.lastError = JSON.stringify({ status: 'success' });
        return await (await handle.getFile()).text();
      }
    } catch (e) {
      this._handleError(e);
      return '';
    }
  }

  async _getDataURI(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot read directory');
      if (!this._getPerms(volName, relPath).read)
        throw new Error('PERMISSION_DENIED: Read permission denied');

      if (vol.type === 'RAM') {
        const node = this._traverseRAM(volName, relPath);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        this.lastError = JSON.stringify({ status: 'success' });
        return `data:${node.mime};base64,${this._uint8ArrayToBase64(node.content)}`;
      } else {
        const { handle, type } = await this._resolveOPFSNode(volName, relPath);
        if (type === 'directory') throw new Error('TYPE_MISMATCH: Is a directory');
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();

        const metaKey = `${volName}${relPath}`;
        const mime = this._opfsMeta.get(metaKey) || file.type || 'application/octet-stream';
        this.lastError = JSON.stringify({ status: 'success' });
        return `data:${mime};base64,${this._uint8ArrayToBase64(new Uint8Array(buffer))}`;
      }
    } catch (e) {
      this._handleError(e);
      return '';
    }
  }

  async _exists(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) {
        this.lastError = JSON.stringify({ status: 'success' });
        return true;
      }
      if (vol.type === 'RAM') {
        this._traverseRAM(volName, relPath);
      } else {
        await this._resolveOPFSNode(volName, relPath);
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return true;
    } catch (e) {
      this._handleError(e);
      return false;
    }
  }

  async _isDir(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) {
        this.lastError = JSON.stringify({ status: 'success' });
        return true;
      }
      let isDir = false;
      if (vol.type === 'RAM') {
        isDir = this._traverseRAM(volName, relPath).type === 'dir';
      } else {
        isDir = (await this._resolveOPFSNode(volName, relPath)).type === 'directory';
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return isDir;
    } catch (e) {
      this._handleError(e);
      return false;
    }
  }

  async listFiles(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      const isRecursive = args.DEPTH === 'all';
      const names = [];

      // Check view permission on the target directory before traversing
      if (!this._getPerms(volName, relPath || '').view) {
        throw new Error('PERMISSION_DENIED: View permission denied on directory');
      }

      const traverseRAM = (node, currentPath) => {
        if (node.type !== 'dir') return;
        for (const [name, child] of node.children.entries()) {
          const childRelPath = currentPath ? `${currentPath}/${name}` : name;
          if (this._getPerms(volName, childRelPath).view) {
            names.push(isRecursive && currentPath ? `${currentPath}/${name}` : name);
            if (isRecursive && child.type === 'dir') traverseRAM(child, childRelPath);
          }
        }
      };

      const traverseOPFS = async (dirHandle, currentPath) => {
        for await (const [name, handle] of dirHandle.entries()) {
          // Skip internal metadata sidecar
          if (name === '.kx_metadata') continue;

          const childRelPath = currentPath ? `${currentPath}/${name}` : name;
          if (this._getPerms(volName, childRelPath).view) {
            names.push(isRecursive && currentPath ? `${currentPath}/${name}` : name);
            if (isRecursive && handle.kind === 'directory')
              await traverseOPFS(handle, childRelPath);
          }
        }
      };

      if (vol.type === 'RAM') {
        const node = !relPath ? vol.root : this._traverseRAM(volName, relPath);
        if (node.type !== 'dir') throw new Error('TYPE_MISMATCH: Not a directory');
        traverseRAM(node, isRecursive ? '' : relPath);
      } else {
        const node = !relPath
          ? {
              handle: await (
                await this._getOPFSRoot()
              ).getDirectoryHandle(volName.replace('://', '')),
            }
          : await this._resolveOPFSNode(volName, relPath);
        if (node.type && node.type !== 'directory')
          throw new Error('TYPE_MISMATCH: Not a directory');
        await traverseOPFS(node.handle, isRecursive ? '' : relPath);
      }
      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify(names);
    } catch (e) {
      this._handleError(e);
      return '[]';
    }
  }

  async deletePath(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot delete volume root');
      if (!this._getPerms(volName, relPath).delete)
        throw new Error('PERMISSION_DENIED: Delete permission denied');

      if (vol.type === 'RAM') {
        const { parent, name } = this._traverseRAM(volName, relPath, { parentOnly: true });
        if (!parent.children.has(name)) throw new Error('NOT_FOUND: Path does not exist');
        const targetNode = parent.children.get(name);
        const stats = await this._getRAMNodeStats(targetNode);
        parent.children.delete(name);
        vol.size -= stats.size;
        vol.fileCount -= stats.count;
      } else {
        const { parent, name } = await this._resolveOPFSNode(volName, relPath, {
          parentOnly: true,
        });
        let sizeFreed = 0;
        let filesFreed = 0;
        try {
          const file = await (await parent.getFileHandle(name)).getFile();
          sizeFreed = file.size;
          filesFreed = 1;
        } catch (_e) {
          try {
            const dirHandle = await parent.getDirectoryHandle(name);
            const stats = await this._getDirectoryStats(dirHandle);
            sizeFreed = stats.size;
            filesFreed = stats.count;
          } catch (_e2) {
            throw new Error('NOT_FOUND: Path does not exist', { cause: _e2 });
          }
        }
        await parent.removeEntry(name, { recursive: true });

        const prefix = `${volName}${relPath}`;
        for (const key of this._opfsMeta.keys()) {
          if (key === prefix || key.startsWith(prefix + '/')) this._opfsMeta.delete(key);
        }
        for (const key of this._opfsPerms.keys()) {
          if (key === prefix || key.startsWith(prefix + '/')) this._opfsPerms.delete(key);
        }

        vol.size -= sizeFreed;
        vol.fileCount -= filesFreed;

        // Persist metadata so deletions are durable across reloads. Use the
        // per-volume serialization promise to avoid races.
        if (this.volumes[volName] && this.volumes[volName].type === 'OPFS') {
          this._opfsPersistPromises = this._opfsPersistPromises || {};
          const prev = this._opfsPersistPromises[volName] || Promise.resolve();
          const next = prev
            .catch(() => {})
            .then(() => this._persistOPFSMetadata(volName))
            .finally(() => {
              if (this._opfsPersistPromises[volName] === next) {
                delete this._opfsPersistPromises[volName];
              }
            });
          this._opfsPersistPromises[volName] = next;
          await next;
        }
      }
      this._pathCache.clear(); // Safety clear on delete
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  // --- Export / Import System ---

  async exportVolume(args) {
    await this._ready;
    try {
      const target = args.VOL.trim();
      const exportObj = {};

      const serializeRAMNode = node => {
        if (node.type === 'file') {
          return {
            type: 'file',
            mime: node.mime,
            content: this._uint8ArrayToBase64(node.content),
            perms: node.perms,
          };
        }
        const children = {};
        for (const [name, child] of node.children.entries())
          children[name] = serializeRAMNode(child);
        return { type: 'dir', perms: node.perms, children };
      };

      const serializeOPFSNode = async (handle, currentPath, volName) => {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const buffer = await file.arrayBuffer();
          const metaKey = `${volName}${currentPath}`;
          const mime = this._opfsMeta.get(metaKey) || 'application/octet-stream';
          const perms = this._opfsPerms.get(metaKey) || {
            read: true,
            write: true,
            create: true,
            view: true,
            delete: true,
            control: true,
          };
          return {
            type: 'file',
            mime,
            content: this._uint8ArrayToBase64(new Uint8Array(buffer)),
            perms,
          };
        }
        const children = {};
        for await (const [name, childHandle] of handle.entries()) {
          if (name === '.kx_metadata') continue; // Internal sidecar: hide from exports/listings
          children[name] = await serializeOPFSNode(
            childHandle,
            currentPath ? `${currentPath}/${name}` : name,
            volName
          );
        }
        const dirPerms = currentPath
          ? this._opfsPerms.get(`${volName}${currentPath}`) || undefined
          : undefined;
        return { type: 'dir', perms: dirPerms, children };
      };

      const volsToExport =
        target === 'all'
          ? Object.keys(this.volumes)
          : [target.endsWith('://') ? target : target + '://'];

      for (const volName of volsToExport) {
        if (!this.volumes[volName]) throw new Error(`NOT_FOUND: Volume ${volName} does not exist`);
        if (!this._getPerms(volName, '').control)
          throw new Error(`PERMISSION_DENIED: Control permission denied for volume ${volName}`);
        const vol = this.volumes[volName];

        let tree;
        if (vol.type === 'RAM') {
          tree = serializeRAMNode(vol.root);
        } else {
          const rootHandle = await (
            await this._getOPFSRoot()
          ).getDirectoryHandle(volName.replace('://', ''));
          tree = await serializeOPFSNode(rootHandle, '', volName);
          tree.perms = vol.perms; // Root perms
        }

        exportObj[volName] = {
          type: vol.type,
          sizeLimit: vol.sizeLimit === Infinity ? '__INFINITY__' : vol.sizeLimit,
          fileCountLimit: vol.fileCountLimit === Infinity ? '__INFINITY__' : vol.fileCountLimit,
          perms: vol.perms,
          tree: tree,
        };
      }

      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify(exportObj);
    } catch (e) {
      this._handleError(e);
      return '{}';
    }
  }

  async importVolume(args) {
    await this._ready;
    try {
      const target = args.VOL.trim();
      let data;
      try {
        data = JSON.parse(args.JSON);
      } catch (e) {
        throw new Error('INVALID_ARGUMENT: Invalid JSON', { cause: e });
      }

      const volsToImport =
        target === 'all' ? Object.keys(data) : [target.endsWith('://') ? target : target + '://'];

      for (const volName of volsToImport) {
        if (!data[volName]) {
          throw new Error(`NOT_FOUND: Volume ${volName} not found in import payload`);
        }
        const volData = data[volName];

        // Ensure volume is mounted and formatted
        let result = await this.mountAs({ VOL: volName, TYPE: volData.type });
        let status = JSON.parse(result);
        if (status.status !== 'success') {
          if (this.volumes[volName]) this.volumes[volName].lastError = result;
          throw new Error('Failed to mount volume: ' + status.message);
        }

        // Handle Infinity sentinel and null for unlimited quotas
        const importedSizeLimit = volData.sizeLimit === '__INFINITY__' || volData.sizeLimit === null ? Infinity : volData.sizeLimit;
        const importedFileCountLimit = volData.fileCountLimit === '__INFINITY__' || volData.fileCountLimit === null ? Infinity : (volData.fileCountLimit ?? (importedSizeLimit === Infinity ? Infinity : 10000));

        result = await this.setSizeLimit({ VOL: volName, LIMIT: importedSizeLimit });
        status = JSON.parse(result);
        if (status.status !== 'success') {
          if (this.volumes[volName]) this.volumes[volName].lastError = result;
          throw new Error('Failed to set size limit: ' + status.message);
        }

        result = await this.setFileCountLimit({
          VOL: volName,
          LIMIT: importedFileCountLimit,
        });
        status = JSON.parse(result);
        if (status.status !== 'success') {
          if (this.volumes[volName]) this.volumes[volName].lastError = result;
          throw new Error('Failed to set file count limit: ' + status.message);
        }

        // Format first with permissive root perms to allow structure creation
        result = await this.formatVolume({ VOL: volName });
        status = JSON.parse(result);
        if (status.status !== 'success') {
          if (this.volumes[volName]) this.volumes[volName].lastError = result;
          throw new Error('Failed to format volume: ' + status.message);
        }

        // Track permissions to apply bottom-up after structure is created
        const permsToApply = [];

        const processNode = async (name, nodeData, currentPath) => {
          const childRelPath = currentPath ? `${currentPath}/${name}` : name;
          if (nodeData.type === 'dir') {
            if (childRelPath) {
              // Create directory structure first
              if (this.volumes[volName].type === 'RAM') {
                this._traverseRAM(volName, childRelPath, { createDirs: true, parentOnly: false });
              } else {
                await this._resolveOPFSNode(volName, childRelPath, {
                  createDirs: true,
                  parentOnly: false,
                });
              }
            }
            // Defer permission application
            if (nodeData.perms && childRelPath) {
              permsToApply.push({ path: childRelPath, perms: nodeData.perms });
            }
            // Recurse into children first
            if (nodeData.children) {
              for (const [childName, childNode] of Object.entries(nodeData.children)) {
                await processNode(childName, childNode, childRelPath);
              }
            }
          } else if (nodeData.type === 'file') {
            const dataUri = `data:${nodeData.mime};base64,${nodeData.content}`;
            // Overwrite path directly using fileWrite string format
            const writeArgs = { MODE: 'write', STRING: dataUri, PATH: `${volName}${childRelPath}` };

            const result = await this._writePath(writeArgs);
            const status = JSON.parse(result);
            if (status.status !== 'success') {
              throw new Error('Failed to write file: ' + status.message);
            }

            // Defer file permission application
            if (nodeData.perms) {
              permsToApply.push({ path: childRelPath, perms: nodeData.perms });
            }
          }
        };

        if (volData.tree && volData.tree.children) {
          for (const [name, childNode] of Object.entries(volData.tree.children)) {
            await processNode(name, childNode, '');
          }
        }

        // Apply all permissions bottom-up (deepest first)
        permsToApply.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
        for (const { path, perms } of permsToApply) {
          for (const [k, v] of Object.entries(perms)) {
            await this._setPerm(volName, path, k, v);
          }
          // Update _opfsPerms for OPFS volumes
          if (this.volumes[volName].type === 'OPFS') {
            const metaKey = `${volName}${path}`;
            this._opfsPerms.set(metaKey, perms);
          }
        }

        // Apply root permissions last
        this.volumes[volName].perms = volData.perms || {
          read: true,
          write: true,
          create: true,
          view: true,
          delete: true,
          control: true,
        };

        if (this.volumes[volName].type === 'OPFS') {
          const metaKey = `${volName}`;
          this._opfsPerms.set(metaKey, this.volumes[volName].perms);
        }
      }

      this._pathCache.clear();
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  // --- Permission Block Implementations ---

  async setPermission(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      const perm = args.PERM;
      const value = args.VALUE === 'allow';

      if (vol.type === 'RAM') {
        if (relPath) this._traverseRAM(volName, relPath);
      } else {
        if (relPath) await this._resolveOPFSNode(volName, relPath);
      }

      if (!this._getPerms(volName, relPath).control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      await this._setPerm(volName, relPath, perm, value);

      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async checkPermission(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      const perm = args.PERM;

      // Validate the permission type before checking its value
      const validPerms = ['read', 'write', 'create', 'view', 'delete', 'control'];
      if (typeof perm !== 'string' || !validPerms.includes(perm)) {
        this._handleError(new Error('INVALID_ARGUMENT: Invalid permission type'));
        return false;
      }

      // Verify target exists (align behavior with other permission-related methods)
      if (relPath) {
        try {
          if (vol.type === 'RAM') {
            this._traverseRAM(volName, relPath);
          } else {
            await this._resolveOPFSNode(volName, relPath);
          }
        } catch (e) {
          // Target doesn't exist
          this._handleError(e);
          return false;
        }
      }

      const perms = this._getPerms(volName, relPath);
      this.lastError = JSON.stringify({ status: 'success' });
      return Object.prototype.hasOwnProperty.call(perms, perm) && perms[perm] === true;
    } catch (e) {
      this._handleError(e);
      return false;
    }
  }

  getLastError() {
    return this.lastError;
  }

  // --- Diagnostics Test ---

  async runIntegrityTest() {
    await this._ready;
    try {
      const assert = (cond, msg) => {
        if (!cond) throw new Error(msg);
      };
      const assertOK = (res, msg) => {
        let st;
        try {
          st = JSON.parse(res).status;
        } catch (e) {
          throw new Error(msg + ' (invalid JSON: ' + res + ')', { cause: e });
        }
        if (st !== 'success') throw new Error(msg + ': ' + res);
      };
      const assertErr = (res, msg) => {
        let st;
        try {
          st = JSON.parse(res).status;
        } catch (e) {
          throw new Error(msg + ' (invalid JSON: ' + res + ')', { cause: e });
        }
        if (st !== 'error') throw new Error(msg + ' (expected error, got success)');
      };

      const vol = 'testfs://';

      // 1. Mount test volume
      assertOK(await this.mountAs({ VOL: vol, TYPE: 'RAM' }), 'Mount');

      // 2. Join Paths
      assert(
        this.joinPaths({ P1: vol + 'dir', P2: 'file.txt' }) === vol + 'dir/file.txt',
        'Join Paths'
      );

      // 3. Write
      assertOK(
        await this.fileWrite({ MODE: 'write', STRING: 'hello', PATH: vol + 'f1.txt' }),
        'Write'
      );

      // 4. Read
      assert((await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' })) === 'hello', 'Read');

      // 5. Append
      assertOK(
        await this.fileWrite({ MODE: 'append', STRING: ' world', PATH: vol + 'f1.txt' }),
        'Append'
      );
      assert(
        (await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' })) === 'hello world',
        'Append Read'
      );

      // 6. Path Checks
      assert(
        (await this.pathCheck({ PATH: vol + 'f1.txt', CONDITION: 'exists' })) === true,
        'Exists (true)'
      );
      assert(
        (await this.pathCheck({ PATH: vol + 'fake.txt', CONDITION: 'exists' })) === false,
        'Exists (false)'
      );
      assert(
        (await this.pathCheck({ PATH: vol + 'f1.txt', CONDITION: 'is a directory' })) === false,
        'IsDir (false)'
      );

      // 7. Data URI Check
      const b64 = btoa('test');
      assertOK(
        await this.fileWrite({
          MODE: 'write',
          STRING: 'data:text/plain;base64,' + b64,
          PATH: vol + 'img.txt',
        }),
        'DataURI Write'
      );
      assert(
        (await this.fileRead({ PATH: vol + 'img.txt', FORMAT: 'text' })) === 'test',
        'DataURI Read Text'
      );

      // 8. List Files
      let files = JSON.parse(await this.listFiles({ DEPTH: 'immediate', PATH: vol }));
      assert(files.includes('f1.txt') && files.includes('img.txt'), 'List Files');

      // 9. Limits
      assertOK(await this.setFileCountLimit({ VOL: vol, LIMIT: 2 }), 'Set Limit');
      await this.fileWrite({ MODE: 'write', STRING: 'x', PATH: vol + 'f3.txt' });
      assertErr(this.lastError, 'Quota bypass');

      // 10. Permissions
      assertOK(
        await this.setPermission({ PATH: vol + 'f1.txt', PERM: 'read', VALUE: 'deny' }),
        'Set Perm'
      );
      assert(
        (await this.checkPermission({ PATH: vol + 'f1.txt', PERM: 'read' })) === false,
        'Check Perm'
      );
      await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' });
      assertErr(this.lastError, 'Perm bypass');

      // 11. Delete
      assertOK(await this.deletePath({ PATH: vol + 'img.txt' }), 'Delete');
      assert(
        (await this.pathCheck({ PATH: vol + 'img.txt', CONDITION: 'exists' })) === false,
        'Delete Verify'
      );

      // 12. Format
      assertOK(await this.formatVolume({ VOL: vol }), 'Format');
      files = JSON.parse(await this.listFiles({ DEPTH: 'immediate', PATH: vol }));
      assert(files.length === 0, 'Format Verify');

      // Cleanup test volume completely to prevent clutter
      delete this.volumes[vol];
      if (this._opfsPersistPromises && this._opfsPersistPromises[vol]) {
        delete this._opfsPersistPromises[vol];
      }

      return 'OK';
    } catch (e) {
      return 'FAIL: ' + e.message;
    }
  }
}

Scratch.extensions.register(new triflareVolumes());