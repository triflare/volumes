import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
      // Keep this message short and stable for tests which assert on it.
      unsupportedReason = 'Volumes requires OPFS support.';
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
  },

  _supportsOPFS() {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
  },

  async _getOPFSRoot() {
    if (!this._supportsOPFS()) {
      throw new Error('INTERNAL_ERROR: OPFS unsupported');
    }

    return navigator.storage.getDirectory();
  },

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
  },

  _log(...args) {
    if (!this.VolumesLogEnabled) return;

    console.log(...args);
  },

  _warn(...args) {
    if (!this.VolumesLogEnabled) return;

    console.warn(...args);
  },

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
  },

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
  },

  _base64ToUint8Array(base64) {
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
    return bytes;
  },

  _uint8ArrayToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32KB chunks
    const chunks = [];
    for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
    }
    return btoa(chunks.join(''));
  },

  _normalizeDispatchToken(rawValue, mapping, argName) {
    const token = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
    if (!Object.prototype.hasOwnProperty.call(mapping, token)) {
      throw new Error(
        `INVALID_ARGUMENT: Invalid ${argName}: ${String(rawValue)} (expected one of: ${Object.keys(mapping).join(', ')})`
      );
    }
    return mapping[token];
  },

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
  },

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
  },

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
  },

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
  },

  _normalizeVolumeName(volInput) {
    let volName = String(volInput || '').trim();
    if (!volName.endsWith('://')) volName += '://';
    return volName;
  },

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
  },

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
  },

  _getWatcherCursorEventId(watcher) {
    if (!watcher) return 0;
    if (Number.isFinite(watcher.cursorEventId)) return watcher.cursorEventId;
    if (Number.isFinite(watcher.cursor)) return watcher.cursor;
    return 0;
  },

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
  },

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
  },

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
  },

  // --- RAM Engine ---
  _createRAMNode(type, mime = 'text/plain') {
    return {
      type: type,
      children: type === 'dir' ? new Map() : null,
      content: type === 'file' ? new Uint8Array(0) : null,
      mime: mime,
      perms: { read: true, write: true, create: true, view: true, delete: true, control: true },
    };
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
});
