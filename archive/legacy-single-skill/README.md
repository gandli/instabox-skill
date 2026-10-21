# Archived: the original single-skill Instabox guide

This directory preserves the repository's first skill (2026-10-18). It described the
Instabox HTTP API, TypeScript SDK and CLI as one skill, with `references/` for the full
API surface and `scripts/ibx.mjs`, a dependency-free Node 18+ HTTP client for `/v1`.

## Do not install this as a skill

It predates the current product and several statements are out of date, for example:

- sandbox sizes are no longer fixed (paid plans choose `--vcpus`/`--mem-mib`);
- snapshots are shared with the source sandbox's org, not private to the account;
- sandboxes have no lifetime timeout; they pause when idle;
- org Secrets exist alongside the legacy Vault.

Use the maintained skills in [`../../skills/`](../../skills/) instead.

## Still useful

`scripts/ibx.mjs` remains a small, dependency-free client for the documented `/v1` API
when the CLI is unavailable. Its subcommands and auth (`INSTABOX_API_KEY`) still work,
but it is not maintained and does not cover newer endpoints (org Secrets, workspaces,
snapshot status, orca).
