import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
  async createSnapshot(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const snapName = String(args.SNAP || '').trim();
      if (!snapName) throw new Error('INVALID_ARGUMENT: Snapshot name is required');
      if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');
      if (this.volumes[volName].type === 'VARCH') {
        throw new Error('FORBIDDEN: operation not allowed on VARCH');
      }
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
  },

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
  },

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
  },

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
  },

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
  },
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

      // Flatten a snapshot tree to a Map of relPath -> { size, mime, content }
      // Only file nodes are included; directories are skipped.
      const flattenForDelta = (node, currentPath, output) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'file') {
          const content = node.content || '';
          const mime = node.mime || 'application/octet-stream';
          // Store content length for a fast pre-filter: if lengths differ, files definitely differ
          output.set(currentPath, { size: content.length, mime, content });
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

      // Each entry in the result carries enough information to apply (or reverse) the diff:
      //   added    — { path, mime, content }           write this file to apply
      //   modified — { path, mime, before, after }     write `after` to apply, `before` to revert
      //   deleted  — { path, mime, content }           delete path to apply, write content to revert
      const added = [];
      const modified = [];
      const deleted = [];

      for (const [path, entry2] of m2.entries()) {
        if (!m1.has(path)) {
          added.push({ path, mime: entry2.mime, content: entry2.content });
        } else {
          const entry1 = m1.get(path);
          // Size mismatch short-circuits the expensive string comparison
          if (entry1.size !== entry2.size) {
            modified.push({
              path,
              mime: entry2.mime,
              before: entry1.content,
              after: entry2.content,
            });
          } else if (entry1.content !== entry2.content) {
            modified.push({
              path,
              mime: entry2.mime,
              before: entry1.content,
              after: entry2.content,
            });
          }
        }
      }

      for (const [path, entry1] of m1.entries()) {
        if (!m2.has(path)) deleted.push({ path, mime: entry1.mime, content: entry1.content });
      }

      this.lastError = JSON.stringify({ status: 'success' });
      return JSON.stringify({ added, modified, deleted });
    } catch (e) {
      this._handleError(e);
      return JSON.stringify({ added: [], modified: [], deleted: [] });
    }
  },
});
