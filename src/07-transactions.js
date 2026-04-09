import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
  async beginTransaction(args) {
    await this._ready;
    try {
      const volName = this._normalizeVolumeName(args.VOL);
      const txName = String(args.TXN || 'main').trim() || 'main';
      if (!this.volumes[volName]) throw new Error('NOT_FOUND: Volume not found');
      if (this.volumes[volName].type === 'VARCH') {
        throw new Error('FORBIDDEN: operation not allowed on VARCH');
      }
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
  },

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
  },

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
  },

  async listTransactions() {
    await this._ready;
    const items = [];
    for (const [volName, tx] of this._transactions.entries()) {
      items.push({ volume: volName, name: tx.name, startedAt: tx.startedAt });
    }
    return JSON.stringify(items);
  },
});
