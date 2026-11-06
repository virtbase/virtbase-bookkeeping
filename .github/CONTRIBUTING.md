# Contributing

Thanks for helping out. Bug reports and pull requests are welcome.

## Setup

```bash
bun install
BOOKKEEPING_HOME=~/Bookkeeping-test bun run dev
```

Always set `BOOKKEEPING_HOME` during development, otherwise the app uses the real data in `~/Bookkeeping`. The VS Code tasks and debug profiles already do this.

## Before you open a pull request

Run `bun run verify`. It runs Biome, the type check and the tests, like CI does.

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), because releases and the changelog are built from them. For example: `fix: keep filters after a reload`. The Git hooks check this for you.

## Never include real data

Tests, screenshots and issues must only use made-up names, amounts and keys. Please remove customer data and API keys from logs before you post them.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
