import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
  },

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
  },
});
