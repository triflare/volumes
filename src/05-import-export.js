import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
  // --- Export / Import System ---

  async exportVolume(args) {
    await this._ready;
    try {
      const target = args.VOL.trim();
      const exportObj = {};

      // Check for VARCH volumes early
      const volsToCheck =
        target === 'all'
          ? Object.keys(this.volumes)
          : [target.endsWith('://') ? target : target + '://'];
      for (const volName of volsToCheck) {
        if (this.volumes[volName] && this.volumes[volName].type === 'VARCH') {
          throw new Error('FORBIDDEN: operation not allowed on VARCH');
        }
      }

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
  },

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
        // Check if target volume is VARCH (read-only archive)
        if (this.volumes[volName] && this.volumes[volName].type === 'VARCH') {
          throw new Error('FORBIDDEN: operation not allowed on VARCH');
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
  },
});
