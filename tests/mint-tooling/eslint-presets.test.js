import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ESLint } from 'eslint';

import blockTypeMatchRule from '../../eslint/block-type-match.js';
import noHeavyComputationInReporterRule from '../../eslint/no-heavy-computation-in-reporter.js';
import noSyncInHatRule from '../../eslint/no-sync-in-hat.js';
import opcodeNamingRule from '../../eslint/opcode-naming.js';
import requireGetInfoRule from '../../eslint/require-getinfo.js';
import requireScratchTranslateRule from '../../eslint/require-scratch-translate.js';
import turboWarpQueryRules from '../../eslint/turbowarp-query-rules.js';
import validArgumentTypesRule from '../../eslint/valid-argument-types.js';
import { loadMintRc } from '../../mintrc.js';

async function lintWithRule(ruleName, rule, code, severity = 'error') {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          globals: {
            Scratch: 'readonly',
          },
        },
        plugins: {
          turbowarp: {
            rules: {
              [ruleName]: rule,
            },
          },
        },
        rules: {
          [`turbowarp/${ruleName}`]: severity,
        },
      },
    ],
  });

  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(process.cwd(), 'src/01-core.js'),
  });
  return result.messages;
}

describe('TurboWarp ESLint preset rules', () => {
  it('require-getinfo reports classes without getInfo()', async () => {
    const messages = await lintWithRule(
      'require-getinfo',
      requireGetInfoRule,
      'class TurboWarpExtension {} Scratch.extensions.register(new TurboWarpExtension());'
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/require-getinfo');
  });

  it('require-getinfo checks the class that is actually registered', async () => {
    const messages = await lintWithRule(
      'require-getinfo',
      requireGetInfoRule,
      `
      class HasInfo { getInfo() { return {}; } }
      class MissingInfo {}
      Scratch.extensions.register(new MissingInfo());
      `
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/require-getinfo');
  });

  it('opcode-naming reports non-camelCase opcodes', async () => {
    const messages = await lintWithRule(
      'opcode-naming',
      opcodeNamingRule,
      "class E{getInfo(){return{blocks:[{opcode:'HelloWorld'}]}}}"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/opcode-naming');
  });

  it('block-type-match rejects isTerminal reporter blocks', async () => {
    const messages = await lintWithRule(
      'block-type-match',
      blockTypeMatchRule,
      "class E{getInfo(){return{blocks:[{opcode:'x',blockType:'reporter',isTerminal:true}]}}}"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/block-type-match');
  });

  it('valid-argument-types reports unsupported argument types', async () => {
    const messages = await lintWithRule(
      'valid-argument-types',
      validArgumentTypesRule,
      "class E{getInfo(){return{blocks:[{opcode:'x',arguments:{A:{type:'notAType'}}}]}}}"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/valid-argument-types');
  });

  it('no-sync-in-hat reports loop-based hat handlers', async () => {
    const messages = await lintWithRule(
      'no-sync-in-hat',
      noSyncInHatRule,
      "class E{getInfo(){return{blocks:[{opcode:'tick',blockType:'hat'}]}} tick(){for(let i=0;i<10;i++){} }}"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/no-sync-in-hat');
  });

  it('no-heavy-computation-in-reporter reports loop-heavy reporter handlers', async () => {
    const messages = await lintWithRule(
      'no-heavy-computation-in-reporter',
      noHeavyComputationInReporterRule,
      "class E{getInfo(){return{blocks:[{opcode:'calc',blockType:'reporter'}]}} calc(){while(true){break;} return 1;}}"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/no-heavy-computation-in-reporter');
  });

  it('translate-strings reports non-translated UI strings', async () => {
    const messages = await lintWithRule(
      'translate-strings',
      requireScratchTranslateRule,
      "class E{getInfo(){return{name:'My Extension',blocks:[{opcode:'x',text:'hello'}]}}}"
    );
    assert.ok(messages.length >= 1);
    assert.equal(messages[0].ruleId, 'turbowarp/translate-strings');
  });

  it('no-new-syntax reports nullish coalescing assignment', async () => {
    const messages = await lintWithRule(
      'no-new-syntax',
      turboWarpQueryRules['no-new-syntax'],
      'x ??= y;'
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/no-new-syntax');
  });

  it('no-new-syntax reports Object.hasOwn usage', async () => {
    const messages = await lintWithRule(
      'no-new-syntax',
      turboWarpQueryRules['no-new-syntax'],
      "Object.hasOwn(target, 'key');"
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/no-new-syntax');
  });

  it('use-scratch-fetch reports global fetch usage', async () => {
    const messages = await lintWithRule(
      'use-scratch-fetch',
      turboWarpQueryRules['use-scratch-fetch'],
      'fetch("https://example.com");'
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/use-scratch-fetch');
  });

  it('use-scratch-fetch reports window.fetch usage', async () => {
    const messages = await lintWithRule(
      'use-scratch-fetch',
      turboWarpQueryRules['use-scratch-fetch'],
      'window.fetch("https://example.com");'
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/use-scratch-fetch');
  });

  it('no-translate-alias reports Scratch.translate aliasing', async () => {
    const messages = await lintWithRule(
      'no-translate-alias',
      turboWarpQueryRules['no-translate-alias'],
      'const t = Scratch.translate;'
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'turbowarp/no-translate-alias');
  });
});

describe('loadMintRc()', () => {
  it('loads lint rule customizations from .mintrc.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mintrc-test-'));
    fs.writeFileSync(
      path.join(root, '.mintrc.json'),
      JSON.stringify({ lint: { rules: { 'turbowarp/opcode-naming': 'error' } } }, null, 2),
      'utf8'
    );

    try {
      const config = loadMintRc(root);
      assert.equal(config.lint.rules['turbowarp/opcode-naming'], 'error');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws a helpful path-aware error for invalid JSON', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mintrc-test-'));
    const configPath = path.join(root, '.mintrc.json');
    fs.writeFileSync(configPath, '{', 'utf8');

    try {
      assert.throws(
        () => loadMintRc(root),
        error => error instanceof SyntaxError && error.message.includes(configPath)
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws when lint.rules is not a plain object', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mintrc-test-'));
    fs.writeFileSync(
      path.join(root, '.mintrc.json'),
      JSON.stringify({ lint: { rules: [] } }),
      'utf8'
    );

    try {
      assert.throws(
        () => loadMintRc(root),
        error =>
          error instanceof TypeError &&
          error.message === 'Expected .mintrc.json lint.rules to be a plain object.'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
