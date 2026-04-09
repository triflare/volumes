import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
  // --- Diagnostics Test ---

  async runIntegrityTest() {
    await this._ready;
    try {
      const assert = (cond, msg) => {
        if (!cond) throw new Error(msg);
      };
      const assertOK = (res, msg) => {
        let st;
        try {
          st = JSON.parse(res).status;
        } catch (e) {
          throw new Error(msg + ' (invalid JSON: ' + res + ')', { cause: e });
        }
        if (st !== 'success') throw new Error(msg + ': ' + res);
      };
      const assertErr = (res, msg) => {
        let st;
        try {
          st = JSON.parse(res).status;
        } catch (e) {
          throw new Error(msg + ' (invalid JSON: ' + res + ')', { cause: e });
        }
        if (st !== 'error') throw new Error(msg + ' (expected error, got success)');
      };

      const suffix = Math.random().toString(36).slice(2, 10);
      const vol = `testfs-${suffix}://`;
      let created = false;

      try {
        // 1. Mount test volume
        assertOK(await this.mountAs({ VOL: vol, TYPE: 'RAM' }), 'Mount');
        created = true;

        // 2. Join Paths
        assert(
          this.joinPaths({ P1: vol + 'dir', P2: 'file.txt' }) === vol + 'dir/file.txt',
          'Join Paths'
        );

        // 3. Write
        assertOK(
          await this.fileWrite({ MODE: 'write', STRING: 'hello', PATH: vol + 'f1.txt' }),
          'Write'
        );

        // 4. Read
        assert((await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' })) === 'hello', 'Read');

        // 5. Append
        assertOK(
          await this.fileWrite({ MODE: 'append', STRING: ' world', PATH: vol + 'f1.txt' }),
          'Append'
        );
        assert(
          (await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' })) === 'hello world',
          'Append Read'
        );

        // 6. Path Checks
        assert(
          (await this.pathCheck({ PATH: vol + 'f1.txt', CONDITION: 'exists' })) === true,
          'Exists (true)'
        );
        assert(
          (await this.pathCheck({ PATH: vol + 'fake.txt', CONDITION: 'exists' })) === false,
          'Exists (false)'
        );
        assert(
          (await this.pathCheck({ PATH: vol + 'f1.txt', CONDITION: 'is a directory' })) === false,
          'IsDir (false)'
        );

        // 7. Data URI Check
        const b64 = btoa('test');
        assertOK(
          await this.fileWrite({
            MODE: 'write',
            STRING: 'data:text/plain;base64,' + b64,
            PATH: vol + 'img.txt',
          }),
          'DataURI Write'
        );
        assert(
          (await this.fileRead({ PATH: vol + 'img.txt', FORMAT: 'text' })) === 'test',
          'DataURI Read Text'
        );

        // 8. List Files
        let files = JSON.parse(await this.listFiles({ DEPTH: 'immediate', PATH: vol }));
        assert(files.includes('f1.txt') && files.includes('img.txt'), 'List Files');

        // 9. Limits
        assertOK(await this.setFileCountLimit({ VOL: vol, LIMIT: 2 }), 'Set Limit');
        await this.fileWrite({ MODE: 'write', STRING: 'x', PATH: vol + 'f3.txt' });
        assertErr(this.lastError, 'Quota bypass');

        // 10. Permissions
        assertOK(
          await this.setPermission({ PATH: vol + 'f1.txt', PERM: 'read', VALUE: 'deny' }),
          'Set Perm'
        );
        assert(
          (await this.checkPermission({ PATH: vol + 'f1.txt', PERM: 'read' })) === false,
          'Check Perm'
        );
        await this.fileRead({ PATH: vol + 'f1.txt', FORMAT: 'text' });
        assertErr(this.lastError, 'Perm bypass');

        // 11. Delete
        assertOK(await this.deletePath({ PATH: vol + 'img.txt' }), 'Delete');
        assert(
          (await this.pathCheck({ PATH: vol + 'img.txt', CONDITION: 'exists' })) === false,
          'Delete Verify'
        );

        // 12. Format
        assertOK(await this.formatVolume({ VOL: vol }), 'Format');
        files = JSON.parse(await this.listFiles({ DEPTH: 'immediate', PATH: vol }));
        assert(files.length === 0, 'Format Verify');
      } finally {
        if (created) {
          delete this.volumes[vol];
          if (this._opfsPersistPromises && this._opfsPersistPromises[vol]) {
            delete this._opfsPersistPromises[vol];
          }
        }
      }

      return 'OK';
    } catch (e) {
      return 'FAIL: ' + e.message;
    }
  },
});
