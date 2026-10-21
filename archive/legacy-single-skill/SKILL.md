---
name: instabox
description: Run and manage InstaBox cloud Linux machines (sandboxes) — create, pause, resume, stop and delete them; run shell commands and move files; save and reuse snapshots; connect over SSH or mosh; publish public HTTPS ports; drive the desktop over VNC; and read metrics, usage and limits. Works through the instabox CLI, the HTTP API at https://api.instabox.sh, or the TypeScript SDK @insforge/instabox-sdk. Use when a task mentions instabox.sh, an ibk_ API key, a disposable cloud dev box, or a remote Linux VM for an agent, a test run or CI.
license: MIT
---

# InstaBox

InstaBox gives you Linux VMs in the cloud ("machines", also called sandboxes): 4 vCPUs, 8 GiB RAM, 20 GiB persistent `/data`, Docker and root. You drive them from the CLI, plain HTTP, or the TypeScript SDK. Every change is asynchronous and returns an *operation* you wait on.

- **Base URL:** `https://api.instabox.sh`
- **Auth:** `X-API-Key: ibk_...` (or `Authorization: Bearer ibk_...`)
- **Docs:** https://instabox.sh/docs · **OpenAPI:** https://api.instabox.sh/v1/openapi.json

## Credentials

Read the key from the environment; never inline it in code, a browser bundle, a screenshot or a commit.

```bash
export INSTABOX_API_KEY=ibk_...            # required
export INSTABOX_API_URL=https://api.instabox.sh   # optional, this is the default
```

Keep it in a `.env` that is gitignored, load it in the shell (`set -a; . ./.env; set +a`), and use a secret store in production. A key with `machines:write` can read the account's Vault through `exec` in a machine it creates: pass `"vault": false` for machines that run other people's code.

## Pick an interface

| Interface | Use when | Reference |
|---|---|---|
| CLI `instabox` | Interactive work, scripts, agents on a shell | [references/cli.md](references/cli.md) |
| HTTP API | Any language, CI, server code, no install | [references/http-api.md](references/http-api.md) |
| TypeScript SDK | Node/Bun/Deno apps that create and drive machines | [references/sdk.md](references/sdk.md) |

Install the CLI or the SDK once:

```bash
curl -fsSL https://api.instabox.sh/install.sh | sh   # CLI (or: npx instabox@latest sh)
npm install @insforge/instabox-sdk                    # SDK
```

If you have neither and only need one call, `scripts/ibx.mjs` is a dependency-free Node 18+ client for the documented HTTP API:

```bash
node scripts/ibx.mjs ls
node scripts/ibx.mjs create dev --template universal --timeout 30m
node scripts/ibx.mjs exec dev -- uname -a
```

## The 60-second path

```bash
instabox create --name dev --template universal   # waits until it runs
instabox exec dev -- uname -a
instabox files dev /data/home
instabox suspend dev                              # keeps memory and processes
instabox resume dev
instabox rm dev                                   # deletes machine and disks
```

Same thing over HTTP:

```bash
H="X-API-Key: $INSTABOX_API_KEY"
curl -s -X POST "$INSTABOX_API_URL/v1/machines" -H "$H" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"name":"dev","templateId":"universal","timeoutSeconds":1800}'
# → 202 {"id":"op_...","machineId":"m_...","type":"create","state":"queued"}
curl -s "$INSTABOX_API_URL/v1/operations/op_...?wait=25s" -H "$H"   # repeat until state=succeeded
curl -s -X POST "$INSTABOX_API_URL/v1/machines/m_.../exec" -H "$H" \
  -H 'Content-Type: application/json' -d '{"cmd":"uname -a"}'
```

## The operation model (read this before writing code)

Every create, start, stop, suspend (pause), resume and delete answers `202 Accepted` with an operation, and **a machine runs one operation at a time**. Doing the next change before the previous ends gets `409 operation_conflict` with the blocking `operationId`.

- Poll `GET /v1/operations/{id}?wait=25s` in a loop (long poll, max 30 s per call) until `state` is `succeeded` or `failed`; no sleeping needed. The CLI and SDK already wait — pass `--no-wait` only when you truly don't care.
- Endpoints that document an `Idempotency-Key` header **require** one: any unique string (UUID). Reusing it for the same request replays the response instead of acting twice; reusing it for a *different* request is `409 idempotency_conflict`. Keys live 7 days. Lifecycle, `PATCH`/`DELETE` machine, snapshot save/delete and SSH certificates require it. `exec`, `ssh-tokens`, ports, `wake` and desktop calls do not.
- An operation that ends `failed` carries `error.code`/`error.message`; read it rather than retrying blindly.

## Task recipes

Each recipe shows the CLI and the endpoint; details and every option are in the references.

### Create, inspect, delete

```bash
instabox templates                     # agent-browser (default), universal, herdr, orca
instabox create --name job --template universal --timeout 30m --on-timeout kill \
  --meta task=review --no-wait
instabox get job --json
instabox ls --meta task=review
instabox rm job
```

`POST /v1/machines` takes `name`, exactly one of `templateId`/`snapshotId`, and optionally `timeoutSeconds`, `onTimeout`, `autoSuspendAfterSeconds`, `metadata`, `guestUser`, `desiredState`. **Leave size fields out** — sizes are fixed and any `vcpus`/`memMiB`/`diskGiB` is `400 spec_not_allowed`.

### Run commands and move files

```bash
instabox exec dev -- uname -a
instabox exec dev --cwd /data/home --env NODE_ENV=production -- 'npm test'
instabox exec dev --stdin < script.sql -- 'psql -f -'
instabox files dev /etc/os-release          # prints a text file
```

`POST /v1/machines/{id}/exec` runs `bash -lc` and returns `{stdout, stderr, exitCode, timedOut, truncated}` when the command exits — output is not streamed. Default timeout 60 s, max 600 s; 1 MiB stdin; stdout and stderr are each cut at 1 MiB. For longer work use `background: true` in the SDK, `tmux`, or a public port. `GET /v1/machines/{id}/files?path=...` lists a directory (≤5000 entries) or returns a text file (≤256 KiB) as root. The SDK's `sbx.files.write` is the way to write files (≤10 MiB, creates parent directories).

### Pause, resume, stop

```bash
instabox suspend dev     # suspend = pause: memory and processes kept
instabox resume dev
instabox stop dev        # processes end, /data kept
instabox start dev       # boots fresh
```

A machine paused *by its own idle timer* (default 30 min) wakes automatically on a command, file read, SSH connection or public-port visit. A machine **you** paused or stopped, or that hit its timeout, stays offline until you resume or start it. A paused machine cannot be stopped: resume or delete it.

### Timeouts and idle pause

```bash
instabox timeout dev 1h            # pause it in an hour (0 clears)
instabox timeout dev 1h --on-timeout kill
instabox auto-suspend dev 10m      # idle pause (0 turns it off)
```

Timeout range 60 s – 24 h, but capped at 4 h (14400 s) unless the account has manual lifecycle. `autoSuspendAfterSeconds` is only honoured with manual lifecycle; otherwise every machine pauses after a fixed 1800 s and the reply says so.

### Labels (metadata)

Up to 32 `key=value` pairs, plain text — not for secrets. Filter on every key you pass:

```bash
instabox create --name job --meta task=review --meta team=infra
instabox ls --meta task=review            # GET /v1/machines?metadata=task:review
instabox get job --json | jq .metadata
```

### Snapshots

A snapshot keeps installed software and everything under `/data` (home, repos, saved sign-ins) — not memory or processes.

```bash
instabox snapshot save dev --name dev-base          # waits; --no-wait returns at once
instabox create --name dev2 --snapshot dev-base
instabox snapshot ls
instabox snapshot files dev-base /etc               # without starting a machine
instabox snapshot rm dev-base
```

Saving a running machine stops it first unless the server supports live saves; `--root-only` saves only installed software. Deleting a machine keeps its snapshots.

### SSH and mosh

```bash
instabox ssh dev                       # certificate + known_hosts + ssh
instabox ssh dev -- uname -a
instabox ssh-config dev                # a ~/.ssh/config Host block
instabox ssh-token dev                 # one ssh command, no key, 7 days
instabox mosh dev
```

Gateway is `api.instabox.sh:2222`. An SSH token (`ibssh_...`) is shown once and works until it expires or is revoked; a certificate signs your own public key for up to 24 h (`POST /v1/machines/{id}/connections`). Supported: pty, exec, subsystem, env, signals, local port forwarding, mosh. Not supported: agent forwarding, X11, remote forwarding. Connections drop when the machine stops, pauses or is deleted.

### Public ports

```bash
instabox port publish dev 3000 --name 'Web app'   # prints https://3000-<machine>.instabox.tech
instabox port ls dev
instabox port unpublish dev 3000
```

Up to 16 per machine. **The URL is public**: anyone with it reaches the whole service until you unpublish. A visit wakes an idle-paused machine and waits for it to run; a machine you paused or stopped returns 503. Publishing does not start your server. Inside the machine, `instabox-port publish 3000` does the same (`instabox port setup dev` installs it).

### Desktop (VNC)

Machines from `agent-browser` have a Linux desktop with a browser. The SDK is the ergonomic way to drive it:

```ts
await sbx.desktop.start({ width: 1280, height: 800 })
await sbx.desktop.open('https://example.com')
const png = await sbx.desktop.screenshot()
await sbx.desktop.click(640, 400)
await sbx.desktop.press(['ctrl', 'l'])
await sbx.desktop.type('instabox.sh')
const { url, expiresAt } = await sbx.desktop.streamUrl({ viewOnly: true, ttlSeconds: 3600 })
await sbx.desktop.revokeStreamUrls()
```

Over HTTP: `POST /v1/machines/{id}/desktop` with `{"action":"status"|"install"|"start"|"takeover"|"handback"}`; `POST /v1/machines/{id}/desktop/stream` mints a link (`viewOnly` defaults to true); `DELETE .../desktop/stream` revokes every link and closes viewers. The link is view-only enforced server-side and is not an API key. Screen 800–2560 × 600–1600.

### Vault (secrets)

The Vault writes your secrets into every machine at boot, start and resume: `env` items are exported in login shells, `file` items land under home. Values are write-only. `env`/`file` items can be limited to machines by label selector.

```bash
instabox vault set ANTHROPIC_API_KEY                 # value from stdin or a hidden prompt
instabox vault set-file backend/.env --from ./local.env
instabox vault set DATABASE_URL --selector project=shop
instabox vault ls                                    # names only, never values
instabox vault push box                              # write into a running machine now
instabox create --name box --no-vault                # never receives them
```

**API keys cannot manage the Vault** (`GET /v1/vault`, `GET /v1/keys` answer `403 permission_denied`); use the CLI or dashboard sign-in. An API key *can* read what a machine received (`GET /v1/machines/{id}/vault`, `machines:read`) and push the current items in (`POST .../vault`, `machines:write`).

### Usage, metrics, limits

```bash
instabox usage                     # machines, snapshots, stored bytes, limits
instabox whoami
```

- `GET /v1/usage` — account counts, stored bytes (measured hourly), limits.
- `GET /v1/machines/{id}/metrics?since=...` — CPU/memory samples, one per 30 s, oldest first, up to 24 h back; empty while the machine is not running.
- `GET /v1/machines/{id}/usage?from=&to=` — `runningSeconds`, `vcpuSeconds`, `memGiBSeconds`, `diskGiBSeconds`; default the current UTC month, at most 366 days.

## Rules that prevent mistakes

- **One operation per machine.** Wait for it before the next change.
- **Never send the API key to a browser.** Desktop stream links are the browser-safe artifact.
- **Fixed size.** 4 vCPU / 8 GiB / 20 GiB for every machine; omit size fields.
- **Default limits:** 5 machines (paused and stopped count), 10 snapshots, 200 GB stored, 20 API keys, 16 ports/machine, 32 labels/machine, 32 concurrent `exec`-class requests, 10 min per command.
- **`exec` is not a terminal.** No streaming, no TTY, 1 MiB output cap. Use SSH/mosh for interactive work.
- **Public port URLs are public.** Unpublish when done.
- **Rotate, don't reuse, credentials.** A key that leaks: revoke it (`instabox keys rm`) — its SSH certificates die with it.
- **Retry only what is retryable.** `retryable: true` (and 502/503/504/network errors) may succeed later; `409 operation_conflict` means wait, not retry; `429 quota_exceeded` means delete something.

## References

| File | Read when |
|---|---|
| [references/cli.md](references/cli.md) | You have the CLI and need an exact command or flag |
| [references/http-api.md](references/http-api.md) | You are calling the API directly: every endpoint, field and response |
| [references/sdk.md](references/sdk.md) | You are writing TypeScript against `@insforge/instabox-sdk` |
| [references/concepts.md](references/concepts.md) | You need states, scopes, error codes, limits or feature semantics in depth |
| [references/openapi.md](references/openapi.md) | You need an endpoint the docs pages do not cover, or the spec itself |

When a call fails, read [references/concepts.md](references/concepts.md#errors) for the code before changing the request.
