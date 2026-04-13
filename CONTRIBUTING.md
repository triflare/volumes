# Contributing to Volumes

> **Note:** "Mint" is Volumes' toolchain. If you see Mint being referenced, that's what it means.

## What You'll Need

1. Any semi-new version of Git
2. A GitHub account
3. Node.js and `npm` installed
4. Working knowledge of JavaScript, YAML, or JSON

## Understanding the Build Script

Mint's build script is something called a "bundler", which means it concatenates _(or combines)_ a set of files into one. In Mint's case, the files it bundles are called "modules" or "ES modules". If you know about Webpack, you'll know exactly what we mean.

The build process outputs three files:

1. `build/extension.js`,
2. `build/min.extension.js` _(if you have `terser`)_, and
3. `build/pretty.extension.js` _(if you have `prettier`)_.

If you ran `npm ci` before building, you will have installed `prettier` and `terser` already. If not, `min.extension.js` and `pretty.extension.js` will not appear. No problem!

## Understanding TurboWarp extensions

> [!INFO]
>
> We have since removed this section to remove the overhead of updating this field if TurboWarp's extension system changes. **If you want guidance, see [TurboWarp's documentation](https://docs.turbowarp.org/development/extensions/introduction).**

## Triflare's Stance on Quality

### Using LLMs to Generate Extensions

If AI code is used, it should meet or exceed human standards. We have both humans _(Triflare's dedicated reviewer team)_ and AIs _(CodeRabbit & GitHub Copilot)_ review all Pull requests to ensure they meet this standard.

> [!WARNING]
>
> A recent U.S. case found that purely AI-generated code may not be eligible for U.S. copyright protection and can be treated as public domain. However, any portions that a human author created or that a human has substantially modified remain eligible for copyright and may be licensed by their copyright holders. This warning applies only to the purely machine-generated parts; human-authored or significantly edited contributions can be copyrighted and licensed.

## Quality Over All

Triflare believes in quality over quantity. We want to keep our tools opinionated, so we will keep ensuring quality to keep it that way. For example, our goal is to turn Mint into something that all TurboWarp extension developers use to code their extensions.

## Testing Your Extension Logic

Mint ships a built-in unit-test scaffold powered by Node's native test runner (`node:test`). No extra frameworks or configuration files are needed.

## Linting & Formatting Presets

Mint ships TurboWarp-focused ESLint defaults in `eslint.config.mjs`, including checks for:

- `turbowarp/require-getinfo`
- `turbowarp/opcode-naming`
- `turbowarp/block-type-match`
- `turbowarp/no-sync-in-hat`
- `turbowarp/translate-strings`
- `turbowarp/valid-argument-types`
- `turbowarp/no-heavy-computation-in-reporter`
- `turbowarp/no-new-syntax`
- `turbowarp/no-xmlhttprequest`
- `turbowarp/use-scratch-vm`
- `turbowarp/use-scratch-fetch`
- `turbowarp/use-scratch-open-window`
- `turbowarp/use-scratch-redirect`
- `turbowarp/check-can-fetch`
- `turbowarp/no-translate-setup`
- `turbowarp/no-translate-alias`
- `turbowarp/should-not-translate`

You can customize lint severities with `.mintrc.json`:

```json
{
  "lint": {
    "rules": {
      "turbowarp/require-getinfo": "error",
      "turbowarp/opcode-naming": "warn"
    }
  }
}
```

Prettier is also pre-configured for extension development in `.prettierrc.json` (including
`src/**/*.js` overrides for consistent `getInfo()` block formatting). Customize formatting directly
in `.prettierrc.json` as needed. Use `.prettierignore` to keep generated files and docs out of
format runs.

### Running Tests

```bash
# Run all tests once
npm run test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch
```

### Test File Layout

Place your test files in the `tests/` directory using the `.test.js` suffix:

```text
tests/
  helpers/
    mock-scratch.js   # Scratch environment mock (provided)
  01-core.test.js     # Extension scaffold tests
  02-example-module.test.js
  mint-tooling/
    build-cache.test.js
    build-report.test.js
    build-sourcemap.test.js
    init.test.js
    update-mint.test.js
    validate-assets.test.js
```

### Testing Helper Functions (Pure Logic)

Functions exported from your modules can be imported and asserted against directly — no Scratch mock required:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDistance } from '../src/02-example-module.js';

describe('calculateDistance()', () => {
  it('computes a 3-4-5 right triangle distance', () => {
    assert.equal(calculateDistance({ X1: 0, Y1: 0, X2: 3, Y2: 4 }), 5);
  });
});
```

### Testing Block Methods (Extension Class)

The extension class references the `Scratch` global, which doesn't exist in Node.js. Use the provided `installScratchMock` helper before importing your extension module:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

// Install the mock BEFORE importing the extension source.
const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

await import('../src/01-core.js');

describe('add()', () => {
  it('adds two numbers', () => {
    assert.equal(extension.add({ A: 3, B: 4 }), 7);
  });
});
```

### Common Patterns

| What to test              | How                                                                    |
| ------------------------- | ---------------------------------------------------------------------- |
| Exported helper function  | Import directly and call with mock `args`                              |
| Block method return value | Install the Scratch mock, import the core, call `extension.<method>()` |
| `getInfo()` metadata      | Assert `typeof info.id`, `Array.isArray(info.blocks)`, etc.            |
| Edge cases / defaults     | Pass `{}` or partial `args` objects                                    |
