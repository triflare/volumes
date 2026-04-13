# Updating Mint Tooling

If your extension repository was created from the Mint template, you can pull in the latest Mint tooling updates with:

```bash
npm run update:mint
```

This command:

- fetches the latest `main` branch from `triflare/mint-tooling`
- checks out all Mint files except paths you explicitly exclude
- updates tooling-related `package.json` fields (`type`, `main`, `scripts`, `devDependencies`) while preserving your project metadata and custom dependencies
- prints a message indicating Mint tooling is already up to date when no updates are needed

## Safety checks

- If the fetched latest commit changes `scripts/update-mint.js`, the updater stops and asks you to manually cherry-pick the latest updater commit(s) first.
- If your Mint version is already aligned with upstream (detected from `@triflare/mint-tooling` version metadata), this is used as an extra up-to-date signal.

## Dynamic structure support

`update:mint` supports custom project layouts without editing the script:

1. **Configurable excluded paths** via `package.json`
2. **Path aliases/redirects** via `package.json`
3. **Ignored update paths** via `.mintignore`

### package.json configuration

```json
{
  "mint": {
    "updateMint": {
      "excludePaths": [
        "src",
        "tests/01-core.test.js",
        "tests/02-example-module.test.js",
        "tests/helpers",
        "build",
        "package.json",
        "package-lock.json"
      ],
      "pathAliases": {
        "docs/mint-tooling": "documentation/mint-tooling"
      }
    }
  }
}
```

- `excludePaths` overrides the default blacklist of paths that should not be updated.
- By default, extension scaffold tests (`tests/01-core.test.js`, `tests/02-example-module.test.js`, and `tests/helpers/`) are excluded, while tooling tests under `tests/mint-tooling/` are updated.
- `pathAliases` remaps upstream paths to your local structure after checkout.

**Important:** The `excludePaths` array shown above fully replaces the default blacklist used by `scripts/update-mint.js`. If you specify `excludePaths` in your `package.json`, the updater uses your list exactly rather than merging it with the defaults. The script's default blacklist includes: `.mintignore`, `README.md`, `SETUP.MD`, `QUICKSTART.md`, `LICENSE`, `CONTRIBUTING.md`, `src`, `tests/01-core.test.js`, `tests/02-example-module.test.js`, `tests/helpers`, `build`, `package.json`, `package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock`. To preserve default exclusions, include those defaults alongside any custom entries. See the `excludePaths` and `pathAliases` keys above for how these settings are applied.

### .mintignore

Create a `.mintignore` file at repository root to skip selected paths:

```gitignore
# skip docs updates
docs/mint-tooling

# skip workflow updates
.github/workflows
```

Each entry ignores both the exact path and anything under it.

### Automatic docs alias detection

If `docs/mint-tooling` is selected for update, and your repo has `documentation/mint-tooling` but no `docs/mint-tooling`, the updater automatically redirects docs updates to `documentation/mint-tooling`.

## Options

- `--dry-run` — show what would be updated without changing files
- `--ref <ref>` — update from a specific branch, tag, or commit
- `--remote <url-or-remote>` — update from a custom Mint fork or remote

Examples:

```bash
npm run update:mint -- --dry-run
npm run update:mint -- --ref v2.0.5
npm run update:mint -- --remote https://github.com/your-org/mint-tooling.git --ref main
```

After updating, review your diff and run:

```bash
npm install
```

to refresh lockfiles if dependency versions changed.
