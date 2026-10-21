# Instabox agent skills

Four [agent skills](https://agentskills.io) for [Instabox](https://instabox.sh) —
cloud Linux sandboxes you create, drive and throw away from the terminal. This is a
hardened fork of the skills shipped by `npx instabox@latest` (npm `instabox` 0.6.3),
with the correctness fixes listed [below](#changes-from-upstream).

| Skill | Use when | Covers |
|---|---|---|
| [`instabox`](skills/instabox/SKILL.md) | Any work with an Instabox box: create, SSH/exec, files, ports, desktop, pause, delete | CLI, templates, sizes, org Secrets, feedback |
| [`instabox-snapshots`](skills/instabox-snapshots/SKILL.md) | "save a snapshot", "restore/load a box", "clone this box" | `snapshot save/ls/files/rm`, `create --snapshot` |
| [`instabox-move-repo`](skills/instabox-move-repo/SKILL.md) | "move this repo to instabox", "continue this work in the cloud" | repo + worktrees, Claude/Codex conversations, dependency install |
| [`instabox-basic-setup`](skills/instabox-basic-setup/SKILL.md) | "put my tokens / dotfiles / git config into instabox" | org Secrets, git/editor config copies |

Each skill is a directory with a `SKILL.md`; the longer workflows ship scripts beside
it that the agent runs locally or on the box.

## Install

With the [`skills`](https://github.com/vercel-labs/skills) CLI (choose skills and agents):

```bash
npx skills add gandli/instabox-skill
```

Or copy a skill into your agent's skills directory:

```bash
cp -r skills/instabox ~/.claude/skills/instabox     # Claude Code
cp -r skills/instabox ~/.agents/skills/instabox     # other agents using ~/.agents
```

The official installer (`npx instabox@latest`) signs you in, installs the `instabox`
CLI and writes the upstream skills to `~/.claude/skills` and `~/.agents/skills`. It uses
the same skill names, so install **one** set: if you install these, either skip the
installer's skills (`--no-skills`) or remove `metadata.installed-by` from the installed
copies so later CLI updates keep your version.

## Requirements

- Node.js 18+ and `bash` for the bundled scripts.
- `jq` for `instabox-basic-setup` and `instabox-move-repo`; `git` ≥ 2.36 and `tar` for
  `instabox-move-repo`.
- Python 3 inside sandboxes that receive config files (`instabox-basic-setup`).
- macOS or Linux for the shell workflows; on Windows use WSL or Git Bash (the
  `instabox` CLI itself also runs natively).

## Repository layout

```text
skills/
  instabox/SKILL.md
  instabox-snapshots/SKILL.md
  instabox-move-repo/{SKILL.md,scripts/}
  instabox-basic-setup/{SKILL.md,scripts/}
  LICENSE, NOTICE                  # skills are Apache-2.0, derived from instabox
tools/validate-skills.mjs          # frontmatter/discovery checks
.github/workflows/validate.yml     # runs the checks and syntax checks on push/PR
```

## Validate

```bash
node tools/validate-skills.mjs
```

Checks that every `skills/<name>/SKILL.md` has matching frontmatter, a `Use when`
description and balanced code fences, and that no stray `SKILL.md` exists outside
`skills/`.

## Changes from upstream

Correctness:

- **Accounts:** GitHub and Google sign-ins are separate accounts, even with the same
  email (the upstream skill said they share one).
- **Snapshots:** they belong to the source box's org — every member can see, use and
  delete them — count against the org's limits, must be `ready` before use, and the new
  box always joins the snapshot's org.
- **Idle pause:** a public port URL does not wake an idle-paused box; `exec`, `ssh`,
  `files` and `instabox wake` do. Manual pause/stop stays offline until `resume`/`start`.
- **Idle choices:** documented `manualLifecycle`, `idleChoicesSeconds` and
  `fixedAutoSuspendSeconds` instead of promising `--auto-suspend` works for everyone.
- **Prerequisites:** `jq`/`git`/`tar` and the `exec` timeout (60 s default, 600 s max)
  are stated instead of "nothing to install".
- **Secrets:** proxy delivery scope (HTTPS headers on allowed hosts, port 443, private
  addresses rejected), Vault commands and feedback flags are accurate.

Robustness:

- Skill scripts are located from the skill's own directory instead of a hard-coded
  `~/.claude/skills` path; the docs say when one shell session is required.
- `instabox-move-repo` fails fast (`pipefail` + explicit check), initialises submodules,
  verifies copied history, and documents `--keep`/`--dest`/sanitised names precisely.
- `instabox-basic-setup` documents exit codes, the `org ls --json` shape, JSON
  validation, check-box format and the `orgSecrets` fallback.
- `push.mjs` no longer fails a proxy-only selection when no guest environment is
  installed.
- Skill descriptions are shorter and trigger-focused, with cross-skill routing kept in
  the bodies.

## Safety notes

- `instabox rm` deletes the box and its disks; save a snapshot first if it matters.
- Published port URLs are public to anyone who has them until unpublished.
- `env` Secrets are readable by code in the box; snapshots can contain credentials that
  applications wrote to disk. Never print a credential.
- A box runs one lifecycle operation at a time; wait for the operation before the next.

## License

The repository's own files (README, tooling) are MIT — see [LICENSE](LICENSE). The
skills under [`skills/`](skills/) are derived from the instabox project and licensed
under the Apache License 2.0 — see [skills/LICENSE](skills/LICENSE) and
[skills/NOTICE](skills/NOTICE), which records the modifications.

## Sources

Built from the official documentation (<https://instabox.sh/docs>), the `instabox` CLI
0.6.3 (`instabox help`, `--help` for every subcommand) and the live OpenAPI document
(<https://api.instabox.sh/v1/openapi.json>), read 2026-10-22. The CLI, not this
repository, remains the source of truth when they disagree.
