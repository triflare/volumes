# Agent Guide

If you are an AI agent, you must read this document in its entirety (including its documentation).

## Agent Responsibilities

- Understand the repository structure before making changes.
- Prefer small, focused edits with clear intent.
- Preserve the existing code style, naming conventions, and documentation tone.
- When in doubt, ask for clarification rather than guessing.
- Avoid large refactors without first verifying the impact and test coverage.

## Developing Extensions

If you are developing a custom extension (the JavaScript and TypeScript files in `src/`), expect your extension to be used immediately after generation.

- Treat `src/` as the main extension implementation area.
- Keep changes compatible with the existing extension architecture.
- Update `src/manifest.json` and any asset references if new extension features require them.

## Guidance

- If the user asks to remove a block, do not remove it. Simply hide it from the palette with `hideFromPalette` in `getInfo()`.
- If there are a large number of advanced blocks, you should hide them behind a button.

> In your extension class, create a constructor object/variable that stores whether the section(s) is/are hidden. Then create a block with type `Scratch.BlockType.BUTTON` and set its function to toggle that value. By toggling `hideFromPalette` via a variable/object and then calling `Scratch.vm.extensionManager.refreshBlocks` to do so. **Doing this is not available in sandboxed extensions.**

- Do not put docstrings in `src/`. No other TurboWarp extensions use them and they take space with little to no reward.

## Testing & Validation

- Write tests for new features or bug fixes in `tests/`.
- Ensure new tests cover the intended behavior and edge cases.
- Run the repository test suite before committing.
- Use `npm run fullstack` to validate across most available CI checks.
- If there is a faster local test command for a focused change, use it first, then run the broader suite.

## Code Quality

- Follow existing lint rules and conventions from `eslint.config.mjs`.
- Keep changes readable and maintainable.
- Add or update documentation in `docs/` when behavior, public APIs, or developer workflows change.
- Use conventional commit messages for clarity and change history.

## CI and CD

Before every commit that you make, all CI should pass. Run `npm run fullstack` to test most available CI.

- Prefer making one logical change per branch or pull request.
- Add changelog-worthy notes when a feature or fix is user-facing.

## Conventional Commits

Follow conventional commits in both Git commits and pull request names:

```text
feat: a new feature
fix: oops i broke everything
docs: rewrite documentation for clarity
style: prettify all files
```

## Documentation & Examples

- For extension features, create or update documentation in `docs/`.
- Keep documentation consistent with existing Markdown style.
- Add examples or usage notes when introducing new APIs or workflows.

## Useful Repository Links

1. [TurboWarp Documentation](./docs/turbowarp/)
2. [Mint Tooling Documentation](./docs/mint-tooling/)

## Best Practices

- Check for TODOs or comments that may need follow-up.
- Review changed files for unintended side effects.
- Keep the workspace clean and avoid introducing temporary debugging code.
- When adding new assets, verify the build or packaging scripts still succeed.
