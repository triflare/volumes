import js from '@eslint/js';
import globals from 'globals';
import blockTypeMatch from './eslint/block-type-match.js';
import noHeavyComputationInReporter from './eslint/no-heavy-computation-in-reporter.js';
import noSyncInHat from './eslint/no-sync-in-hat.js';
import opcodeNaming from './eslint/opcode-naming.js';
import requireScratchTranslate from './eslint/require-scratch-translate.js';
import requireGetInfo from './eslint/require-getinfo.js';
import turboWarpQueryRules from './eslint/turbowarp-query-rules.js';
import validArgumentTypes from './eslint/valid-argument-types.js';
import { loadMintRc } from './mintrc.js';

const mintRc = loadMintRc();
const defaultTurboWarpRules = {
  'turbowarp/require-getinfo': 'error',
  'turbowarp/opcode-naming': 'warn',
  'turbowarp/block-type-match': 'error',
  'turbowarp/no-sync-in-hat': 'warn',
  'turbowarp/translate-strings': 'warn',
  'turbowarp/valid-argument-types': 'error',
  'turbowarp/no-heavy-computation-in-reporter': 'warn',
  'turbowarp/no-new-syntax': 'error',
  'turbowarp/no-xmlhttprequest': 'error',
  'turbowarp/use-scratch-vm': 'error',
  'turbowarp/use-scratch-fetch': 'error',
  'turbowarp/use-scratch-open-window': 'error',
  'turbowarp/use-scratch-redirect': 'error',
  'turbowarp/check-can-fetch': 'warn',
  'turbowarp/no-translate-setup': 'error',
  'turbowarp/no-translate-alias': 'error',
  'turbowarp/should-not-translate': 'error',
};
const mintrcLintRules = mintRc?.lint?.rules ?? {};

export default [
  {
    ignores: ['node_modules/', 'build/', 'docs/'],
  },
  {
    files: ['**/*.js', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'warn',
        {
          // This covers normal variables (like _e)
          varsIgnorePattern: '^_',
          // This covers function arguments (like _args)
          argsIgnorePattern: '^_',
          // This covers try/catch errors (like catch (_e))
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-constant-condition': [
        'error',
        {
          checkLoops: false,
        },
      ],
      'no-empty': [
        'error',
        {
          allowEmptyCatch: true,
        },
      ],
      'no-constructor-return': 'error',
      'no-async-promise-executor': 'warn',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unreachable-loop': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-mixed-operators': [
        'error',
        {
          groups: [['&&', '||']],
        },
      ],
      'require-await': 'error',
      'no-console': 'off',
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        Scratch: 'readonly',
        mint: 'readonly',
      },
    },
    plugins: {
      turbowarp: {
        rules: {
          'require-getinfo': requireGetInfo,
          'opcode-naming': opcodeNaming,
          'block-type-match': blockTypeMatch,
          'no-sync-in-hat': noSyncInHat,
          'translate-strings': requireScratchTranslate,
          'valid-argument-types': validArgumentTypes,
          'no-heavy-computation-in-reporter': noHeavyComputationInReporter,
          ...turboWarpQueryRules,
        },
      },
      local: {
        rules: {
          // Backward-compatible alias for existing user overrides.
          'require-scratch-translate': requireScratchTranslate,
        },
      },
    },
    rules: {
      ...defaultTurboWarpRules,
      'no-restricted-globals': [
        'error',
        {
          name: 'vm',
          message: 'Use Scratch.vm instead of the global vm object.',
        },
      ],
      // Keep old namespace available without enabling duplicate diagnostics.
      // Existing projects can migrate from local/require-scratch-translate to
      // turbowarp/translate-strings at their own pace.
      'local/require-scratch-translate': 'off',
      ...mintrcLintRules,
    },
  },
  {
    files: ['scripts/**/*.js', 'eslint.config.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
