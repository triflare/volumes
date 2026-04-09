import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
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
  },

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
  },

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
  },
});
