class triflareVolumes {
  /* global __ASSET__ */

  constructor() {
    this._assertRuntimeSupport();
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
    // Active transaction snapshots (one active transaction per volume)
    this._transactions = new Map(); // volName -> { name, snapshot, startedAt }
    this._maxTransactionSnapshotBytes = 50 * 1024 * 1024;
    // Named point-in-time snapshots per volume
    this._snapshots = new Map(); // volName -> Map(snapshotName, exportJSON)
    this._maxSnapshotsPerVolume = 25;
    // In-memory event log for watch subscriptions
    this._eventLog = [];
    this._maxEventLogEntries = 1000;
    this._nextEventId = 1;
    this._watchers = new Map(); // watcherId -> { id, volName, relPath, recursive, cursor }
    this._nextWatcherId = 1;
    this._textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    // Toggle visibility of advanced block sections (Transactions, Snapshots, Watchers, Management)
    this._advancedBlocksHidden = true;

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
          opcode: 'unmount',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('unmount [VOL]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'myfs://' },
          },
        },
        {
          opcode: 'formatVolume',
          blockType: Scratch.BlockType.COMMAND,
          text: Scratch.translate('format [VOL]'),
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

        // --- Advanced Block Toggle ---
        {
          blockType: Scratch.BlockType.BUTTON,
          text: this._advancedBlocksHidden
            ? Scratch.translate('Show Advanced Blocks ▼')
            : Scratch.translate('Hide Advanced Blocks ▲'),
          func: 'toggleAdvancedBlocks',
        },

        // --- Management (advanced) ---
        {
          blockType: Scratch.BlockType.LABEL,
          text: Scratch.translate('Management'),
          hideFromPalette: this._advancedBlocksHidden,
        },
        {
          opcode: 'mountArchive',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('mount archive [JSON] to volume [VOL]'),
          arguments: {
            JSON: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'archive://' },
          },
        },

        // --- Transactions ---
        {
          blockType: Scratch.BlockType.LABEL,
          text: Scratch.translate('Transactions'),
          hideFromPalette: this._advancedBlocksHidden,
        },
        {
          opcode: 'beginTransaction',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('begin transaction [TXN] on [VOL]'),
          arguments: {
            TXN: { type: Scratch.ArgumentType.STRING, defaultValue: 'main' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'commitTransaction',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('commit transaction on [VOL]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'rollbackTransaction',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('rollback transaction on [VOL]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'listTransactions',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('list active transactions'),
          disableMonitor: false,
        },

        // --- Snapshots ---
        {
          blockType: Scratch.BlockType.LABEL,
          text: Scratch.translate('Snapshots'),
          hideFromPalette: this._advancedBlocksHidden,
        },
        {
          opcode: 'createSnapshot',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('create snapshot [SNAP] of [VOL]'),
          arguments: {
            SNAP: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap1' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'restoreSnapshot',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('restore snapshot [SNAP] on [VOL]'),
          arguments: {
            SNAP: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap1' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'deleteSnapshot',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('delete snapshot [SNAP] on [VOL]'),
          arguments: {
            SNAP: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap1' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
        },
        {
          opcode: 'diffSnapshots',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('diff snapshots [A] and [B] on [VOL]'),
          arguments: {
            A: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap1' },
            B: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap2' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
          disableMonitor: false,
        },
        {
          opcode: 'listSnapshots',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('list snapshots on [VOL]'),
          arguments: {
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
          disableMonitor: false,
        },

        // --- Watchers ---
        {
          blockType: Scratch.BlockType.LABEL,
          text: Scratch.translate('Watchers'),
          hideFromPalette: this._advancedBlocksHidden,
        },
        {
          opcode: 'watchPath',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('watch [PATH] depth [DEPTH]'),
          arguments: {
            PATH: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
            DEPTH: { type: Scratch.ArgumentType.STRING, menu: 'listDepth' },
          },
          disableMonitor: false,
        },
        {
          opcode: 'unwatchPath',
          blockType: Scratch.BlockType.COMMAND,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('unwatch [WATCHER]'),
          arguments: {
            WATCHER: { type: Scratch.ArgumentType.STRING, defaultValue: '1' },
          },
        },
        {
          opcode: 'pollWatcherEvents',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate('poll events for [WATCHER]'),
          arguments: {
            WATCHER: { type: Scratch.ArgumentType.STRING, defaultValue: '1' },
          },
          disableMonitor: false,
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
          opcode: 'snapshotDelta',
          blockType: Scratch.BlockType.REPORTER,
          hideFromPalette: this._advancedBlocksHidden,
          text: Scratch.translate(
            'get changes from snapshot [SNAP1] to snapshot [SNAP2] on volume [VOL]'
          ),
          arguments: {
            SNAP1: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap1' },
            SNAP2: { type: Scratch.ArgumentType.STRING, defaultValue: 'snap2' },
            VOL: { type: Scratch.ArgumentType.STRING, defaultValue: 'tmp://' },
          },
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
        mountAction: { acceptReporters: false, items: ['mount', 'unmount', 'format'] },
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
  _assertRuntimeSupport() {
    let unsupportedReason = '';

    // Explicitly detect file:// and fail fast (common cause when opening local files)
    try {
      if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol === 'file:'
      ) {
        unsupportedReason =
          'Volumes requires a secure context (HTTPS). It appears you are running from a file:// URI — serve the page over HTTPS or use localhost.';
      }
    } catch (_e) {
      /* empty */
    }

    // Prefer to fail fast on insecure contexts (covers http: or other non-secure contexts)
    if (
      !unsupportedReason &&
      typeof globalThis.isSecureContext === 'boolean' &&
      !globalThis.isSecureContext
    ) {
      unsupportedReason =
        'Volumes requires a secure context (HTTPS). Serve over HTTPS or use localhost.';
    }

    // Sandboxed frames cannot access required platform APIs
    if (
      !unsupportedReason &&
      typeof window !== 'undefined' &&
      window.frameElement &&
      typeof window.frameElement.hasAttribute === 'function' &&
      window.frameElement.hasAttribute('sandbox')
    ) {
      unsupportedReason = 'Volumes cannot run in a sandboxed frame.';
    }

    // Finally, verify OPFS support specifically
    if (!unsupportedReason && !this._supportsOPFS()) {
      unsupportedReason =
        'Volumes requires OPFS support (navigator.storage.getDirectory). Your browser or platform may not support it.';
    }

    if (!unsupportedReason) return;

    if (typeof globalThis.alert === 'function') {
      try {
        globalThis.alert(unsupportedReason);
      } catch (_) {
        // Ignore alert failures in restricted runtimes.
      }
    }
    throw new Error(`INTERNAL_ERROR: ${unsupportedReason}`);
  }

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
    else if (message.includes('FORBIDDEN') || e.name === 'ForbiddenError') code = 'FORBIDDEN';

    const errObj = {
      status: 'error',
      code: code,
      message: message.replace(
        /^(NOT_FOUND|TYPE_MISMATCH|QUOTA_EXCEEDED|INVALID_PATH|INVALID_ARGUMENT|PERMISSION_DENIED|FORBIDDEN):\s*/,
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
      const err = new Error('FORBIDDEN: Access to reserved path .kx_metadata');
      err.name = 'ForbiddenError';
      throw err;
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

  _normalizeDispatchToken(rawValue, mapping, argName) {
    const token = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
    if (!Object.prototype.hasOwnProperty.call(mapping, token)) {
      throw new Error(
        `INVALID_ARGUMENT: Invalid ${argName}: ${String(rawValue)} (expected one of: ${Object.keys(mapping).join(', ')})`
      );
    }
    return mapping[token];
  }

  _normalizePermsObject(perms, contextLabel, options = {}) {
    const base = options.includeDefaults
      ? {
          read: true,
          write: true,
          create: true,
          view: true,
          delete: true,
          control: true,
        }
      : {};

    if (perms == null) return base;
    if (typeof perms !== 'object' || Array.isArray(perms)) {
      throw new Error(`INVALID_ARGUMENT: ${contextLabel} must be an object`);
    }

    const allowedKeys = ['read', 'write', 'create', 'view', 'delete', 'control'];
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(perms, key)) continue;
      const value = perms[key];
      if (typeof value !== 'boolean') {
        throw new Error(
          `INVALID_ARGUMENT: ${contextLabel}.${key} must be boolean (received ${String(value)})`
        );
      }
      base[key] = value;
    }

    return base;
  }

  _enqueueOPFSVolumeMutation(volName, operation) {
    this._opfsPersistPromises = this._opfsPersistPromises || {};
    const prev = this._opfsPersistPromises[volName] || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(operation)
      .finally(() => {
        if (this._opfsPersistPromises[volName] === next) {
          delete this._opfsPersistPromises[volName];
        }
      });
    this._opfsPersistPromises[volName] = next;
    return next;
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
    } else if (this.volumes[volName].type === 'VARCH') {
      // VARCH volumes are inherently read-only regardless of embedded node perms
      return { read: true, write: false, create: false, view: true, delete: false, control: false };
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

  _normalizeVolumeName(volInput) {
    let volName = String(volInput || '').trim();
    if (!volName.endsWith('://')) volName += '://';
    return volName;
  }

  _utf8ByteLength(value) {
    const input = String(value || '');
    if (this._textEncoder) {
      return this._textEncoder.encode(input).length;
    }
    let bytes = 0;
    for (let i = 0; i < input.length; i++) {
      const codePoint = input.codePointAt(i);
      if (codePoint <= 0x7f) bytes += 1;
      else if (codePoint <= 0x7ff) bytes += 2;
      else if (codePoint <= 0xffff) bytes += 3;
      else bytes += 4;
    }
    return bytes;
  }

  _emitEvent(type, volName, relPath = '', detail = {}) {
    const event = {
      id: this._nextEventId++,
      ts: Date.now(),
      type: String(type),
      volume: volName,
      relPath: relPath || '',
      path: volName + (relPath || ''),
      detail: detail || {},
    };
    this._eventLog.push(event);
    this._pruneEventLog();
  }

  _getWatcherCursorEventId(watcher) {
    if (!watcher) return 0;
    if (Number.isFinite(watcher.cursorEventId)) return watcher.cursorEventId;
    if (Number.isFinite(watcher.cursor)) return watcher.cursor;
    return 0;
  }

  _pruneEventLog() {
    if (!this._eventLog.length) return;

    let minCursorEventId = Infinity;
    for (const watcher of this._watchers.values()) {
      const cursorEventId = this._getWatcherCursorEventId(watcher);
      if (cursorEventId < minCursorEventId) minCursorEventId = cursorEventId;
    }

    if (Number.isFinite(minCursorEventId) && minCursorEventId > 0) {
      const firstKeepIndex = this._eventLog.findIndex(ev => ev.id > minCursorEventId);
      if (firstKeepIndex === -1) this._eventLog.length = 0;
      else if (firstKeepIndex > 0) this._eventLog.splice(0, firstKeepIndex);
    }

    const overflow = this._eventLog.length - this._maxEventLogEntries;
    if (overflow <= 0) return;

    const droppedUntilEventId = this._eventLog[overflow - 1].id;
    this._eventLog.splice(0, overflow);
    for (const watcher of this._watchers.values()) {
      const cursorEventId = this._getWatcherCursorEventId(watcher);
      if (cursorEventId < droppedUntilEventId) watcher.cursorEventId = droppedUntilEventId;
    }
  }

  _watcherMatchesEvent(watcher, event) {
    if (!watcher || !event || watcher.volName !== event.volume) return false;
    const w = watcher.relPath || '';
    const e = event.relPath || '';
    if (!w) {
      if (watcher.recursive) return true;
      if (!e) return true;
      return e.split('/').filter(Boolean).length <= 1;
    }
    if (watcher.recursive) return e === w || e.startsWith(w + '/');
    if (e === w) return true;
    return e.split('/').slice(0, -1).join('/') === w;
  }

  _flattenTreeForDiff(node, currentPath = '', output = new Map()) {
    if (!node || typeof node !== 'object') return output;
    const pathKey = currentPath || '/';
    if (node.type === 'file') {
      output.set(
        pathKey,
        `file|${node.mime || ''}|${node.content || ''}|${JSON.stringify(node.perms || {})}`
      );
      return output;
    }
    output.set(pathKey, `dir|${JSON.stringify(node.perms || {})}`);
    if (node.children && typeof node.children === 'object') {
      for (const [name, child] of Object.entries(node.children)) {
        const childPath = currentPath ? `${currentPath}/${name}` : name;
        this._flattenTreeForDiff(child, childPath, output);
      }
    }
    return output;
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
    const action = args.ACTION || 'mount';

    // Validate action to avoid silent fallthrough on typos like 'unmnt'
    if (!['mount', 'unmount', 'format'].includes(action)) {
      return this._handleError(new Error(`INVALID_ARGUMENT: Invalid ACTION: ${action}`));
    }

    if (action === 'unmount') {
      try {
        let volName = args.VOL.trim();
        if (!volName.endsWith('://')) volName += '://';
        if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');

        // NOTE: Unmount intentionally preserves persistent OPFS on-disk data.
        // It removes only in-memory references (metadata, perms, mounted entries).
        // Use the 'format' action to destroy persistent OPFS contents.
        for (const key of this._opfsMeta.keys())
          if (key.startsWith(volName)) this._opfsMeta.delete(key);
        for (const key of this._opfsPerms.keys())
          if (key.startsWith(volName)) this._opfsPerms.delete(key);

        delete this.volumes[volName];
        this._pathCache.clear(); // Purge cached paths for removed volume
        this.lastError = JSON.stringify({ status: 'success' });
        return this.lastError;
      } catch (e) {
        return this._handleError(e);
      }
    }

    if (action === 'format') {
      return this.formatVolume(args);
    }
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

  async unmount(args) {
    // Delegate to mountAs for consistent behavior and shared validation/error handling
    return this.mountAs({ ACTION: 'unmount', VOL: args.VOL });
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

      // VARCH volumes are read-only; formatting is not allowed
      if (vol.type === 'VARCH') throw new Error('FORBIDDEN: Volume is Read-Only');

      // Align with setPermission root policy: formatting requires root control.
      if (!this._getPerms(volName, '').control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      if (vol.type === 'RAM') {
        vol.root = this._createRAMNode('dir');
        vol.size = 0;
        vol.fileCount = 0;
      } else {
        await this._enqueueOPFSVolumeMutation(volName, async () => {
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

          // Reseed root permissions in memory and persist to metadata sidecar.
          const rootPerms = {
            read: true,
            write: true,
            create: true,
            view: true,
            delete: true,
            control: true,
          };
          this._opfsPerms.set(`${volName}`, rootPerms);
          vol.perms = rootPerms;
          await this._persistOPFSMetadata(volName);
        });
      }
      this._emitEvent('format', volName, '', {});
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async fileWrite(args) {
    try {
      const mode = this._normalizeDispatchToken(
        args.MODE,
        {
          write: 'write',
          append: 'append',
        },
        'MODE'
      );
      if (mode === 'append') return this._appendPath(args);
      return this._writePath(args);
    } catch (e) {
      return this._handleError(e);
    }
  }

  async fileRead(args) {
    try {
      const format = this._normalizeDispatchToken(
        args.FORMAT,
        {
          text: 'text',
          'data uri': 'data-uri',
        },
        'FORMAT'
      );
      if (format === 'data-uri') return this._getDataURI(args);
      return this._readPath(args);
    } catch (e) {
      this._handleError(e);
      return '';
    }
  }

  async pathCheck(args) {
    try {
      const condition = this._normalizeDispatchToken(
        args.CONDITION,
        {
          exists: 'exists',
          'is a directory': 'is-dir',
        },
        'CONDITION'
      );
      if (condition === 'is-dir') return this._isDir(args);
      return this._exists(args);
    } catch (e) {
      this._handleError(e);
      return false;
    }
  }

  // --- Read/Write Implementations ---

  async _writePath(args) {
    await this._ready;
    try {
      const { volName, relPath, vol } = this._parse(args.PATH);
      if (!relPath) throw new Error('INVALID_PATH: Cannot write to root');
      // VARCH volumes are read-only
      if (vol.type === 'VARCH') throw new Error('FORBIDDEN: Volume is Read-Only');
      const { mime, dataBuf } = this._parseDataOrString(args.STRING);
      let created = false;

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
          created = true;
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
                created = true;
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
            if (vol.size + sizeDelta > vol.sizeLimit)
              throw new Error('QUOTA_EXCEEDED: Volume full');

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
      const eventType = args && args._eventType === 'append' ? 'append' : 'write';
      this._emitEvent(eventType, volName, relPath, { created: !!created });
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
      // VARCH volumes are read-only
      if (vol.type === 'VARCH') throw new Error('FORBIDDEN: Volume is Read-Only');
      const { mime, dataBuf } = this._parseDataOrString(args.STRING);
      let created = false;

      if (vol.type === 'RAM') {
        const { parent, name } = this._traverseRAM(volName, relPath, {
          parentOnly: true,
          createDirs: true,
        });
        if (!parent.children.has(name)) {
          return this._writePath({ ...args, _eventType: 'append' }); // Falls back to checking Create permission
        }

        if (!this._getPerms(volName, relPath).write)
          throw new Error('PERMISSION_DENIED: Write permission denied');

        const node = parent.children.get(name);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        if (vol.size + dataBuf.byteLength > vol.sizeLimit)
          throw new Error('QUOTA_EXCEEDED: Volume full');

        const newBuf = new Uint8Array(node.content.byteLength + dataBuf.byteLength);
        newBuf.set(node.content);
        newBuf.set(dataBuf, node.content.byteLength);
        node.content = newBuf;
        vol.size += dataBuf.byteLength;
      } else {
        // Serialize OPFS append mutations per-volume to avoid races with write/delete/format.
        this._opfsPersistPromises = this._opfsPersistPromises || {};
        const prev = this._opfsPersistPromises[volName] || Promise.resolve();
        const next = prev
          .catch(() => {})
          .then(async () => {
            const { parent, name } = await this._resolveOPFSNode(volName, relPath, {
              parentOnly: true,
              createDirs: true,
            });

            let fh;
            let fileSize = 0;
            let isNew = false;
            try {
              fh = await parent.getFileHandle(name);
              fileSize = (await fh.getFile()).size;
            } catch (_e) {
              if (_e && _e.name === 'NotFoundError') {
                isNew = true;
                created = true;
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

              fh = await parent.getFileHandle(name, { create: true });
            }

            if (vol.size + dataBuf.byteLength > vol.sizeLimit)
              throw new Error('QUOTA_EXCEEDED: Volume full');

            const writable = await fh.createWritable({ keepExistingData: !isNew });
            await writable.write({
              type: 'write',
              data: dataBuf,
              position: isNew ? 0 : fileSize,
            });
            await writable.close();

            if (isNew) {
              const metaKey = `${volName}${relPath}`;
              this._opfsMeta.set(metaKey, mime);
              await this._persistOPFSMetadata(volName);
            }

            vol.size += dataBuf.byteLength;
            if (isNew) vol.fileCount++;
          })
          .finally(() => {
            if (this._opfsPersistPromises[volName] === next) {
              delete this._opfsPersistPromises[volName];
            }
          });
        this._opfsPersistPromises[volName] = next;
        await next;
      }
      this._emitEvent('append', volName, relPath, { created: !!created });
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
      } else if (vol.type === 'VARCH') {
        const node = this._traverseVARCH(volName, relPath);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        this.lastError = JSON.stringify({ status: 'success' });
        return new TextDecoder().decode(this._base64ToUint8Array(node.content || ''));
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
      } else if (vol.type === 'VARCH') {
        const node = this._traverseVARCH(volName, relPath);
        if (node.type === 'dir') throw new Error('TYPE_MISMATCH: Is a directory');
        this.lastError = JSON.stringify({ status: 'success' });
        return `data:${node.mime || 'application/octet-stream'};base64,${node.content || ''}`;
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
      } else if (vol.type === 'VARCH') {
        this._traverseVARCH(volName, relPath);
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
      } else if (vol.type === 'VARCH') {
        isDir = this._traverseVARCH(volName, relPath).type === 'dir';
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
      } else if (vol.type === 'VARCH') {
        const node = !relPath ? vol.tree : this._traverseVARCH(volName, relPath);
        if (!node || node.type !== 'dir') throw new Error('TYPE_MISMATCH: Not a directory');
        const traverseVARCH = (vNode, currentPath) => {
          if (!vNode || vNode.type !== 'dir' || !vNode.children) return;
          for (const [name, child] of Object.entries(vNode.children)) {
            const childRelPath = currentPath ? `${currentPath}/${name}` : name;
            if (this._getPerms(volName, childRelPath).view) {
              names.push(isRecursive && currentPath ? `${currentPath}/${name}` : name);
              if (isRecursive && child.type === 'dir') traverseVARCH(child, childRelPath);
            }
          }
        };
        traverseVARCH(node, isRecursive ? '' : relPath);
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
      // VARCH volumes are read-only
      if (vol.type === 'VARCH') throw new Error('FORBIDDEN: Volume is Read-Only');
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
        await this._enqueueOPFSVolumeMutation(volName, async () => {
          const { parent, name } = await this._resolveOPFSNode(volName, relPath, {
            parentOnly: true,
          });
          let sizeFreed;
          let filesFreed;
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
          await this._persistOPFSMetadata(volName);
        });
      }
      this._emitEvent('delete', volName, relPath, {});
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
        const importedSizeLimit =
          volData.sizeLimit === '__INFINITY__' || volData.sizeLimit === null
            ? Infinity
            : volData.sizeLimit;
        const importedFileCountLimit =
          volData.fileCountLimit === '__INFINITY__' || volData.fileCountLimit === null
            ? Infinity
            : (volData.fileCountLimit ?? (importedSizeLimit === Infinity ? Infinity : 10000));

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
                await this._enqueueOPFSVolumeMutation(volName, async () => {
                  await this._resolveOPFSNode(volName, childRelPath, {
                    createDirs: true,
                    parentOnly: false,
                  });
                });
              }
            }
            // Defer permission application
            if (nodeData.perms && childRelPath) {
              const normalizedPerms = this._normalizePermsObject(
                nodeData.perms,
                `permissions for ${volName}${childRelPath}`
              );
              permsToApply.push({ path: childRelPath, perms: normalizedPerms });
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
              const normalizedPerms = this._normalizePermsObject(
                nodeData.perms,
                `permissions for ${volName}${childRelPath}`
              );
              permsToApply.push({ path: childRelPath, perms: normalizedPerms });
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
        }

        // Apply root permissions last
        const normalizedRootPerms = this._normalizePermsObject(
          volData.perms,
          `root permissions for ${volName}`,
          { includeDefaults: true }
        );
        this.volumes[volName].perms = normalizedRootPerms;

        if (this.volumes[volName].type === 'OPFS') {
          for (const [k, v] of Object.entries(normalizedRootPerms)) {
            await this._setPerm(volName, '', k, v);
          }
        }
        this._emitEvent('import', volName, '', {});
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
      const valueToken = typeof args.VALUE === 'string' ? args.VALUE.trim().toLowerCase() : null;
      if (valueToken !== 'allow' && valueToken !== 'deny') {
        throw new Error(
          `INVALID_ARGUMENT: Invalid permission value for ${perm}: ${String(args.VALUE)} (expected allow or deny)`
        );
      }
      const value = valueToken === 'allow';

      if (vol.type === 'RAM') {
        if (relPath) this._traverseRAM(volName, relPath);
      } else {
        if (relPath) await this._resolveOPFSNode(volName, relPath);
      }

      if (!this._getPerms(volName, relPath).control)
        throw new Error('PERMISSION_DENIED: Control permission denied');

      await this._setPerm(volName, relPath, perm, value);

      this._emitEvent('permission', volName, relPath, { perm, value });
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

  async beginTransaction(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const txName = String(args.TXN || 'main').trim() || 'main';
      if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');
      if (this._transactions.has(volName))
        throw new Error(`INVALID_ARGUMENT: Transaction already active on ${volName}`);
      const exportJson = await this.exportVolume({ VOL: volName });
      const snapshotBytes = this._utf8ByteLength(exportJson);
      if (snapshotBytes > this._maxTransactionSnapshotBytes) {
        const limitMb = this._maxTransactionSnapshotBytes / (1024 * 1024);
        const limitText =
          this._maxTransactionSnapshotBytes < 1024 * 1024
            ? `${this._maxTransactionSnapshotBytes} bytes`
            : `${Number(limitMb.toFixed(2))} MB`;
        throw new Error(
          `INVALID_ARGUMENT: Exported transaction snapshot exceeds ${limitText} limit`
        );
      }
      const parsed = JSON.parse(exportJson);
      if (!parsed[volName])
        throw new Error('INTERNAL_ERROR: Failed to capture transaction snapshot');
      const snapshot = JSON.stringify({ [volName]: parsed[volName] });
      this._transactions.set(volName, { name: txName, snapshot, startedAt: Date.now() });
      this._emitEvent('transaction-begin', volName, '', { transaction: txName });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async commitTransaction(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      if (!this._transactions.has(volName))
        throw new Error(`NOT_FOUND: No active transaction on ${volName}`);
      const tx = this._transactions.get(volName);
      this._transactions.delete(volName);
      this._emitEvent('transaction-commit', volName, '', { transaction: tx.name });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async rollbackTransaction(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      if (!this._transactions.has(volName))
        throw new Error(`NOT_FOUND: No active transaction on ${volName}`);
      const tx = this._transactions.get(volName);
      const importResult = await this.importVolume({ VOL: volName, JSON: tx.snapshot });
      const status = JSON.parse(importResult);
      if (status.status !== 'success')
        throw new Error('INTERNAL_ERROR: Failed to rollback transaction');
      this._transactions.delete(volName);
      this._emitEvent('transaction-rollback', volName, '', { transaction: tx.name });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async listTransactions() {
    await this._ready;
    const items = [];
    for (const [volName, tx] of this._transactions.entries()) {
      items.push({ volume: volName, name: tx.name, startedAt: tx.startedAt });
    }
    return JSON.stringify(items);
  }

  async createSnapshot(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const snapName = String(args.SNAP || '').trim();
      if (!snapName) throw new Error('INVALID_ARGUMENT: Snapshot name is required');
      if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');
      const exportJson = await this.exportVolume({ VOL: volName });
      const parsed = JSON.parse(exportJson);
      if (!parsed[volName]) throw new Error('INTERNAL_ERROR: Failed to capture snapshot');
      const volumeSnapshot = JSON.stringify({ [volName]: parsed[volName] });
      if (!this._snapshots.has(volName)) this._snapshots.set(volName, new Map());
      const snapshots = this._snapshots.get(volName);
      if (!snapshots.has(snapName) && snapshots.size >= this._maxSnapshotsPerVolume) {
        throw new Error(
          `QUOTA_EXCEEDED: Snapshot limit (${this._maxSnapshotsPerVolume}) reached for ${volName}`
        );
      }
      snapshots.set(snapName, volumeSnapshot);
      this._emitEvent('snapshot-create', volName, '', { snapshot: snapName });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async restoreSnapshot(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const snapName = String(args.SNAP || '').trim();
      if (!snapName) throw new Error('INVALID_ARGUMENT: Snapshot name is required');
      const byVol = this._snapshots.get(volName);
      if (!byVol || !byVol.has(snapName))
        throw new Error(`NOT_FOUND: Snapshot ${snapName} not found for ${volName}`);
      const importResult = await this.importVolume({ VOL: volName, JSON: byVol.get(snapName) });
      const status = JSON.parse(importResult);
      if (status.status !== 'success')
        throw new Error(`INTERNAL_ERROR: Failed to restore snapshot ${snapName}`);
      this._emitEvent('snapshot-restore', volName, '', { snapshot: snapName });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async deleteSnapshot(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const snapName = String(args.SNAP || '').trim();
      if (!snapName) throw new Error('INVALID_ARGUMENT: Snapshot name is required');
      const byVol = this._snapshots.get(volName);
      if (!byVol || !byVol.has(snapName))
        throw new Error(`NOT_FOUND: Snapshot ${snapName} not found for ${volName}`);
      byVol.delete(snapName);
      if (byVol.size === 0) this._snapshots.delete(volName);
      this._emitEvent('snapshot-delete', volName, '', { snapshot: snapName });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async listSnapshots(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');
      const byVol = this._snapshots.get(volName);
      return JSON.stringify(byVol ? Array.from(byVol.keys()) : []);
    } catch (e) {
      this._handleError(e);
      return '[]';
    }
  }

  async diffSnapshots(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const a = String(args.A || '').trim();
      const b = String(args.B || '').trim();
      if (!a || !b) throw new Error('INVALID_ARGUMENT: Snapshot names are required');
      const byVol = this._snapshots.get(volName);
      if (!byVol || !byVol.has(a))
        throw new Error(`NOT_FOUND: Snapshot ${a} not found for ${volName}`);
      if (!byVol.has(b)) throw new Error(`NOT_FOUND: Snapshot ${b} not found for ${volName}`);

      const sa = JSON.parse(byVol.get(a))[volName];
      const sb = JSON.parse(byVol.get(b))[volName];
      const ma = this._flattenTreeForDiff(sa.tree);
      const mb = this._flattenTreeForDiff(sb.tree);

      const added = [];
      const removed = [];
      const changed = [];
      for (const key of mb.keys()) {
        if (!ma.has(key)) added.push(key);
      }
      for (const key of ma.keys()) {
        if (!mb.has(key)) removed.push(key);
      }
      for (const key of ma.keys()) {
        if (mb.has(key) && ma.get(key) !== mb.get(key)) changed.push(key);
      }

      const diff = {
        volume: volName,
        from: a,
        to: b,
        added,
        removed,
        changed,
      };
      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify(diff);
    } catch (e) {
      this._handleError(e);
      return JSON.stringify({ added: [], removed: [], changed: [] });
    }
  }

  async watchPath(args) {
    await this._ready;
    try {
      const depth = this._normalizeDispatchToken(
        args.DEPTH,
        { immediate: 'immediate', all: 'all' },
        'DEPTH'
      );
      const parsed = this._parse(args.PATH);
      const id = String(this._nextWatcherId++);
      this._watchers.set(id, {
        id,
        volName: parsed.volName,
        relPath: parsed.relPath,
        recursive: depth === 'all',
        cursorEventId: this._nextEventId - 1,
      });
      this.lastError = JSON.stringify({ status: 'success' });
      return id;
    } catch (e) {
      this._handleError(e);
      return '';
    }
  }

  async unwatchPath(args) {
    await this._ready;
    try {
      const watcherId = String(args.WATCHER || '').trim();
      if (!this._watchers.has(watcherId))
        throw new Error(`NOT_FOUND: Watcher ${watcherId} does not exist`);
      this._watchers.delete(watcherId);
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  async pollWatcherEvents(args) {
    await this._ready;
    try {
      const watcherId = String(args.WATCHER || '').trim();
      const watcher = this._watchers.get(watcherId);
      if (!watcher) throw new Error(`NOT_FOUND: Watcher ${watcherId} does not exist`);
      const events = [];
      const cursorEventId = this._getWatcherCursorEventId(watcher);
      for (const ev of this._eventLog) {
        if (ev.id <= cursorEventId) continue;
        if (this._watcherMatchesEvent(watcher, ev)) events.push(ev);
      }
      watcher.cursorEventId = this._nextEventId - 1;
      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify(events);
    } catch (e) {
      this._handleError(e);
      return '[]';
    }
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

      const suffix = Math.random().toString(36).slice(2, 10);
      const vol = `testfs-${suffix}://`;
      let created = false;

      try {
        // 1. Mount test volume
        assertOK(await this.mountAs({ VOL: vol, TYPE: 'RAM' }), 'Mount');
        created = true;

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
      } finally {
        if (created) {
          delete this.volumes[vol];
          if (this._opfsPersistPromises && this._opfsPersistPromises[vol]) {
            delete this._opfsPersistPromises[vol];
          }
        }
      }

      return 'OK';
    } catch (e) {
      return 'FAIL: ' + e.message;
    }
  }

  // --- VARCH (Virtual Archive) Engine ---

  _traverseVARCH(volName, relPath) {
    const vol = this.volumes[volName];
    const tree = vol.tree;
    if (!relPath) return tree;
    const parts = relPath.split('/').filter(p => p);
    let current = tree;
    for (const part of parts) {
      if (
        !current ||
        current.type !== 'dir' ||
        !current.children ||
        !Object.prototype.hasOwnProperty.call(current.children, part)
      ) {
        throw new Error(`NOT_FOUND: Path ${part} does not exist`);
      }
      current = current.children[part];
    }
    return current;
  }

  async mountArchive(args) {
    await this._ready;
    try {
      let volName = String(args.VOL || '').trim();
      if (!volName.endsWith('://')) volName += '://';

      let data;
      try {
        data = JSON.parse(String(args.JSON));
      } catch (e) {
        throw new Error(`INVALID_ARGUMENT: Invalid JSON — ${e.message || String(e)}`, { cause: e });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('INVALID_ARGUMENT: JSON must be an object in Volumes export format');
      }

      if (this.volumes[volName]) {
        throw new Error(`TYPE_MISMATCH: Volume ${volName} is already mounted`);
      }

      // Select the tree: prefer the key matching volName, otherwise take the first key
      let volData = null;
      if (Object.prototype.hasOwnProperty.call(data, volName)) {
        volData = data[volName];
      } else {
        const keys = Object.keys(data);
        if (keys.length === 0) throw new Error('INVALID_ARGUMENT: JSON contains no volumes');
        volData = data[keys[0]];
      }

      if (!volData || typeof volData !== 'object' || !volData.tree) {
        throw new Error('INVALID_ARGUMENT: JSON does not contain a valid volume tree');
      }

      this.volumes[volName] = {
        type: 'VARCH',
        tree: volData.tree,
        sizeLimit: Infinity,
        fileCountLimit: Infinity,
        size: 0,
        fileCount: 0,
        perms: {
          read: true,
          write: false,
          create: false,
          view: true,
          delete: false,
          control: false,
        },
      };

      this._emitEvent('mount', volName, '', { archiveType: 'VARCH' });
      this.lastError = JSON.stringify({ status: 'success' });
      return this.lastError;
    } catch (e) {
      return this._handleError(e);
    }
  }

  // --- Snapshot Delta Diffing ---

  async snapshotDelta(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const snap1 = String(args.SNAP1 || '').trim();
      const snap2 = String(args.SNAP2 || '').trim();
      if (!snap1 || !snap2) throw new Error('INVALID_ARGUMENT: Snapshot names are required');

      const byVol = this._snapshots.get(volName);
      if (!byVol || !byVol.has(snap1))
        throw new Error(`NOT_FOUND: Snapshot ${snap1} not found for ${volName}`);
      if (!byVol.has(snap2))
        throw new Error(`NOT_FOUND: Snapshot ${snap2} not found for ${volName}`);

      const s1 = JSON.parse(byVol.get(snap1))[volName];
      const s2 = JSON.parse(byVol.get(snap2))[volName];

      // Flatten a snapshot tree to a Map of relPath -> { size, content }
      // Only file nodes are included; directories are skipped.
      const flattenForDelta = (node, currentPath, output) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'file') {
          const content = node.content || '';
          // Store content length for a fast pre-filter: if lengths differ, files definitely differ
          output.set(currentPath, { size: content.length, content });
          return;
        }
        if (node.children && typeof node.children === 'object') {
          for (const [name, child] of Object.entries(node.children)) {
            const childPath = currentPath ? `${currentPath}/${name}` : name;
            flattenForDelta(child, childPath, output);
          }
        }
      };

      const m1 = new Map();
      const m2 = new Map();
      flattenForDelta(s1.tree, '', m1);
      flattenForDelta(s2.tree, '', m2);

      const added = [];
      const modified = [];
      const deleted = [];

      for (const [path, entry2] of m2.entries()) {
        if (!m1.has(path)) {
          added.push(path);
        } else {
          const entry1 = m1.get(path);
          // Optimization: skip full content comparison when lengths differ (sizes are O(1) to compare)
          if (entry1.size !== entry2.size) {
            modified.push(path);
          } else if (entry1.content !== entry2.content) {
            modified.push(path);
          }
        }
      }

      for (const path of m1.keys()) {
        if (!m2.has(path)) deleted.push(path);
      }

      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify({ added, modified, deleted });
    } catch (e) {
      this._handleError(e);
      return JSON.stringify({ added: [], modified: [], deleted: [] });
    }
  }

  // --- Advanced Block Visibility Toggle ---

  toggleAdvancedBlocks() {
    this._advancedBlocksHidden = !this._advancedBlocksHidden;
    try {
      if (Scratch.vm && Scratch.vm.extensionManager) {
        Scratch.vm.extensionManager.refreshBlocks();
      }
    } catch (_) {
      // Ignore if refreshBlocks is unavailable in this runtime
    }
  }
}

Scratch.extensions.register(new triflareVolumes());
