# InstaBox skill

An agent skill for [InstaBox](https://instabox.sh) — cloud Linux machines you create, drive and throw away from the CLI, the HTTP API or the TypeScript SDK.

One `SKILL.md` with everything an agent needs to go from "make me a box" to a running command, a snapshot or a shareable desktop link, plus deep reference files it can load only when required.

## What it covers

| Area | In the skill |
|---|---|
| Machines | create, list, get, update, delete; templates; guest user; labels |
| Lifecycle | start, stop, suspend (pause), resume, one-operation-at-a-time, idle pause, wake |
| Timeouts | `timeoutSeconds`, `onTimeout` pause/kill, `autoSuspendAfterSeconds`, archive |
| Commands | `exec` (bash -lc, stdin, cwd, env, limits), output and exit-code behaviour |
| Files | read/list live files, read snapshot files, SDK write/remove/exists |
| Snapshots | save (live and stopped), `rootOnly`, list/get/delete, start from a snapshot |
| SSH | token flow, certificate flow, `ssh-config`, mosh, host CA, supported features |
| Public ports | publish, list, unpublish, URL shape, waking, the public-URL caveat |
| Desktop | start/status, screenshots, click/type/press/scroll, stream links, revoke |
| Vault | env and file items, selectors, push, `--no-vault`, sign-in-only management |
| Metrics & usage | per-machine samples, billing usage, account usage and limits |
| Auth & scopes | `ibk_` keys, scope matrix, which routes reject API keys |
| Errors | every documented code, status mapping and retry rules |
| OpenAPI | full route inventory and how to fetch the live spec |

## Install

With the [skills](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add gandli/instabox-skill
```

Or copy it into your agent's skills directory:

```bash
git clone https://github.com/gandli/instabox-skill.git
cp -r instabox-skill ~/.claude/skills/instabox     # Claude Code
# or: .cursor/skills/, .codex/skills/, ~/.config/agents/skills/, …
```

The skill is plain Markdown — any agent that can read files can use it.

## Set up credentials

```bash
cp .env.example .env      # then put your key in .env
export INSTABOX_API_KEY=ibk_...   # or export it directly
```

`.env` is gitignored. Never commit it, paste it into a browser bundle, or put a key in an HTML page. A key with `machines:write` can read your Vault from a machine it creates, so pass `"vault": false` for machines that run other people's code.

## Quick start

```bash
# official CLI
curl -fsSL https://api.instabox.sh/install.sh | sh
instabox create --name dev --template universal --timeout 30m
instabox exec dev -- uname -a
instabox suspend dev

# or the bundled zero-dependency HTTP client (Node 18+)
node scripts/ibx.mjs create dev --template universal --timeout 30m
node scripts/ibx.mjs exec dev -- uname -a
node scripts/ibx.mjs ls
```

`scripts/ibx.mjs` speaks the documented HTTP API only; it is a fallback for environments without the CLI, not a replacement for it.

## Layout

```
SKILL.md                 entry point: workflows, constraints, pointers
references/cli.md        every CLI command and flag
references/http-api.md   every documented endpoint, field and response
references/sdk.md        @insforge/instabox-sdk classes and methods
references/concepts.md   states, timeouts, vault, scopes, limits, errors
references/openapi.md    full route inventory + live spec
scripts/ibx.mjs          dependency-free HTTP client (Node 18+)
```

Progressive disclosure is deliberate: `SKILL.md` stays small, and the reference files carry the long tables an agent loads only for the task at hand.

## Safety notes baked into the skill

- One operation per machine; wait on `operationId` before the next change.
- Lifecycle and snapshot mutations need an `Idempotency-Key`; `exec` is never retried.
- Public port URLs are public to anyone who has them.
- Machine size is fixed at 4 vCPU / 8 GiB; size fields are rejected.
- Quotas: 5 machines, 10 snapshots, 200 GB, 20 keys, 16 ports per machine.
- Desktop stream links are view-only by default and revocable; they are not API keys.

## Sources

Built from the official documentation (<https://instabox.sh/docs>, read 2026-10-18) and the live OpenAPI document (<https://api.instabox.sh/v1/openapi.json>). Where they differ, the docs pages are treated as the supported contract and the spec as the schema source.

## License

MIT
