import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
      } else if (vol.type === 'VARCH') {
        // VARCH volumes are read-only: control permission is always denied
        throw new Error('FORBIDDEN: Volume is Read-Only');
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
  },

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
          } else if (vol.type === 'VARCH') {
            this._traverseVARCH(volName, relPath);
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
  },

  getLastError() {
    return this.lastError;
  },
});
