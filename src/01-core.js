/* global __ASSET__ */

export class triflareVolumes {

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

}
