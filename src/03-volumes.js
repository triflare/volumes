import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
  },

  async listVolumes() {
    await this._ready;
    return JSON.stringify(Object.keys(this.volumes));
  },

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
  },

  async unmount(args) {
    // Delegate to mountAs for consistent behavior and shared validation/error handling
    return this.mountAs({ ACTION: 'unmount', VOL: args.VOL });
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
});
