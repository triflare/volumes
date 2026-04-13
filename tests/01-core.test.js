import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

await import('../src/01-core.js');

describe('CobaltVDisk — registration', () => {
  it('registers an extension instance with Scratch', () => {
    assert.ok(extension, 'Scratch.extensions.register should have been called');
  });
});

describe('CobaltVDisk — getInfo()', () => {
  it('returns extension metadata and blue block colors', () => {
    const info = extension.getInfo();
    assert.equal(info.id, 'cobaltVDisk');
    assert.equal(info.name, 'CobaltVDisk');
    assert.equal(info.color1, '#007BFF');
  });

  it('declares all required opcodes', () => {
    const opcodes = extension.getInfo().blocks.map(b => b.opcode);
    assert.ok(opcodes.includes('mountVDisk'), 'missing opcode: mountVDisk');
    assert.ok(opcodes.includes('createFile'), 'missing opcode: createFile');
    assert.ok(opcodes.includes('readFile'), 'missing opcode: readFile');
    assert.ok(opcodes.includes('writeFile'), 'missing opcode: writeFile');
    assert.ok(opcodes.includes('removePath'), 'missing opcode: removePath');
    assert.ok(opcodes.includes('createDirectory'), 'missing opcode: createDirectory');
    assert.ok(opcodes.includes('listContents'), 'missing opcode: listContents');
    assert.ok(opcodes.includes('getFileSize'), 'missing opcode: getFileSize');
    assert.ok(opcodes.includes('pathExists'), 'missing opcode: pathExists');
  });
});

describe('CobaltVDisk — async VFS operations', () => {
  it('mounts and supports CRUD plus metadata operations', async () => {
    await extension.mountVDisk();
    await extension.createDirectory({ PATH: '/home/user' });
    await extension.createFile({ PATH: '/home/user/file.txt', DATA: 'hello' });

    assert.equal(await extension.readFile({ PATH: '/home/user/file.txt' }), 'hello');

    await extension.writeFile({ PATH: '/home/user/file.txt', DATA: ' world', MODE: 'append' });
    assert.equal(await extension.readFile({ PATH: '/home/user/file.txt' }), 'hello world');

    await extension.writeFile({ PATH: '/home/user/file.txt', DATA: 'reset', MODE: 'write' });
    assert.equal(await extension.readFile({ PATH: '/home/user/file.txt' }), 'reset');
    assert.equal(await extension.getFileSize({ PATH: '/home/user/file.txt' }), 5);
    assert.equal(await extension.pathExists({ PATH: '/home/user/file.txt' }), true);

    const listed = JSON.parse(await extension.listContents({ PATH: '/home/user' }));
    assert.deepEqual(listed, ['file.txt']);

    await extension.removePath({ PATH: '/home/user/file.txt' });
    assert.equal(await extension.readFile({ PATH: '/home/user/file.txt' }), '');
    assert.equal(await extension.pathExists({ PATH: '/home/user/file.txt' }), false);
  });

  it('normalizes relative paths and dot segments', async () => {
    await extension.createDirectory({ PATH: '/data/docs' });
    await extension.createFile({ PATH: 'data/docs/./note.txt', DATA: 'text' });
    assert.equal(await extension.readFile({ PATH: '/data/docs/../docs/note.txt' }), 'text');
  });

  it('handles missing paths gracefully', async () => {
    await extension.createFile({ PATH: '/missing-parent/file.txt', DATA: 'x' });
    assert.equal(await extension.readFile({ PATH: '/missing-parent/file.txt' }), '');
    assert.equal(await extension.getFileSize({ PATH: '/missing-parent/file.txt' }), 0);
    assert.equal(await extension.pathExists({ PATH: '/missing-parent/file.txt' }), false);
    assert.equal(await extension.listContents({ PATH: '/missing-parent' }), '');
  });
});
