import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
});
