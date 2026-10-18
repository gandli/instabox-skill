# Concepts, limits, scopes and errors

The vocabulary the dashboard, CLI, SDK and API share, and the rules that most often cause a wrong call.

## Words

| Word | What it is |
|---|---|
| **Machine** (sandbox) | A Linux VM of your own in the cloud: its own kernel, root, Docker, and a persistent disk at `/data` (home is `/data/home`). Installed software and files under `/data` survive stop/start. |
| **Template** | What a new machine starts from: `agent-browser` (default; Linux desktop + browser), `universal` (dev plus Docker, Python via uv, Go, Rust), `herdr`, `orca`. |
| **Snapshot** | A saved copy of one of your machines (installed software + `/data`), private to you. New machines can start from it. |
| **Operation** | A change to a machine: `create`, `start`, `stop`, `suspend` (pause), `resume`, `delete`. |
| **API key** | `ibk_…` — how programs, CI and agents authenticate. Scoped. |
| **Vault** | Your secrets, written into machines at boot/start/resume. Values are write-only. |
| **Guest user** | The Linux user inside (`user` on current templates, `dev` on older ones; configurable at create). |

## States

API/CLI state | Dashboard | Files | Memory & processes
---|---|---|---
`running` | Running | kept | running
`suspended` | Paused | kept | kept
`stopped` | Stopped | kept | lost
`deleting`/gone | Deleting/Deleted | gone | gone
`error` | Failed | — | —

Transient states: `creating`, `starting`, `stopping`, `suspending`, `resuming`, `deleting`. The dashboard also shows Resuming and Pausing; the API spells pause `suspend`.

### Pause vs stop vs delete

- **Pause** (`suspend`): memory and running programs are saved; resume continues exactly where it left off (usually about a second). If the memory can't be restored, resume boots fresh: files are kept, processes are not.
- **Stop**: clean shutdown; processes end, files are kept; the next start boots fresh.
- **Delete**: machine and disks are gone. Snapshots made from it survive.
- A **paused machine cannot be stopped** — resume or delete it.

### Idle pause and waking

- A new machine pauses itself after **1800 s (30 min) idle** unless the account has manual lifecycle; `autoSuspendAfterSeconds: 0` turns it off (with manual lifecycle).
- Waking is automatic only for an **idle** pause: a command, file read, SSH connection, SSH-token use, or a visit to a published port resumes it (the request waits). `POST /v1/machines/{id}/wake` does the same deliberately.
- A machine **you** paused/stopped, or that hit its **timeout**, stays offline until you resume or start it. A published port then answers 503 at the same URL; after a stop, start your server again.

### One operation at a time

Every change returns an operation and the machine runs one at a time. The next change while one runs is `409 operation_conflict` with the blocking `operationId`. Poll `GET /v1/operations/{id}?wait=25s` until `succeeded`/`failed`. CLI and SDK wait for you; `--no-wait` skips it.

## Timeouts

- `timeoutSeconds` / `timeoutMs`: pause (default) or delete the machine that long after creation (or after a `PATCH`/`setTimeout`). Range 60 s – 24 h, **capped at 4 h (14400 s)** unless the account has manual lifecycle (check `maxTimeoutSeconds` on `GET /v1/me`). `0` clears it.
- `onTimeout`: `pause` (default) or `kill` (delete).
- A timeout is used once: a resumed machine has none until you set one again. A machine busy with another operation is handled when that finishes.
- **Idle pause** (`autoSuspendAfterSeconds`, `setAutoSuspend`) is a separate timer: 120–86400 s, `0` never. Without manual lifecycle the server always uses 1800 s and the reply shows the effective value.
- **Archive** (`archiveSeconds`, `archiveMs`): stop the machine at that time, independent of the timeout (60–86400 s).

## Labels (metadata)

Up to 32 `key=value` string pairs per machine, stored in plain text — use for organization, **never for secrets**. Filter with repeated `metadata`:

```bash
GET /v1/machines?metadata=task:review&metadata=team:infra     # both must match
```

`PATCH /v1/machines/{id}` with `metadata` replaces the whole map; `{}` clears it.

## Vault

The Vault exists where the server enables it (`limits.vault` in `GET /v1/usage`). It writes items into **every** machine at boot, start and resume:

- `env` item → exported in login shells.
- `file` item → written under home (so snapshots include it).
- Values are **write-only**: listing shows names only; set an item again to rotate it.
- A selector (`key=value`) limits an item to machines with those labels.

Managing items needs a **sign-in session** (CLI or dashboard); API keys get `403 permission_denied` on `/v1/vault` and `/v1/keys`. An API key can still read what a machine received (`GET /v1/machines/{id}/vault`, needs `machines:read`) and push current items in (`POST .../vault`, needs `machines:write`).

A key with `machines:write` can therefore read your Vault through `exec` in a machine it creates. When a key creates machines for other people, pass `"vault": false` (or `--no-vault`); it is fixed at create.

## Snapshots

- A snapshot holds installed software and everything under `/data`: home, workspace, saved sign-ins (gh, Claude, Codex, git, SSH). It does **not** hold memory or running processes.
- Saving a stopped machine is immediate (`201`). Saving a running machine is live where supported (`202`, `pending` until uploaded, and it omits data not yet written to disk); elsewhere it stops the machine first.
- `rootOnly` / `--root-only` saves installed software only: machines from it start with an empty home and workspace.
- `snapshot files` / `GET /v1/snapshots/{id}/files` browses saved software without starting a machine; `/data` is not shown there.
- Quota: 10 snapshots, counted with machines against 200 GB storage. Deleting a machine keeps its snapshots; deleting a snapshot does not affect machines made from it.
- A machine created from a snapshot gets at least that snapshot's storage size.

## SSH

- Gateway `api.instabox.sh:2222`, username = machine ID (certificate flow) or `ibssh_...` (token flow).
- **Token:** one `ssh` line, no key, shown once, TTL 7 days by default (max 30), revocable per token or all at once. First connection asks you to confirm the host key.
- **Certificate:** signs your own public key (default 1 h, max 24 h); trust the returned host CA, log in as the machine ID.
- **mosh:** supported through the same gateway (UDP relayed). Install mosh locally; old snapshots need `sudo apt install mosh` once.
- Supported: pty, shell, exec, subsystem, env, signals, local port forwarding. Not supported: agent forwarding, X11, remote forwarding.
- Connections close when the machine stops, pauses or is deleted.

## Public ports

- URL shape: `https://<port>-<machineId>.instabox.tech`. Max 16 per machine.
- **Public**: anyone with the URL reaches the whole service on that port until you unpublish. Do not expose a port you don't intend to.
- Publishing does not start your server. Republishing keeps the URL.
- A visit wakes an idle-paused machine and waits; manual pause/stop/timeout → 503.
- Unpublishing closes open connections; the server inside keeps running.
- Inside the machine use `instabox-port` (`instabox port setup` installs it).

## Desktop

- Machines from `agent-browser` have a Linux desktop: Xvfb, Xfce, Chromium, VNC server on display `:1` (loopback, no password; the API WebSocket is the way in).
- Dashboard: the **Computer** tab. Clicking takes control; it returns to the agent after a minute idle.
- SDK: full input/screenshot control. A view-only link is enforced by the server; the link is not an API key.
- `start()` is idempotent. A template without the desktop installs it on first use (~30 s).

## Account limits (defaults)

| What | Default |
|---|---|
| Machines | 5, in any state (paused and stopped count) |
| Machine size | 4 vCPU, 8 GiB RAM (fixed for every new machine) |
| Snapshot storage | 20 GiB `/data` + 16 GiB root per machine; 200 GB stored per account (measured hourly) |
| Snapshots | 10 |
| API keys | 20 active |
| `exec` concurrency | 32 requests at once across your machines (shared with file reads, desktop, port-forward, vault push); over → retryable `429 quota_exceeded` |
| `exec` duration | 10 minutes per command |
| Timeout | 1 minute – 24 hours (4 h cap without manual lifecycle) |
| Labels | 32 per machine |
| Public ports | 16 per machine |
| Vault | 100 items / 256 KiB (where enabled) |

Over the machine or storage limit, new machines and snapshots are refused (`429 quota_exceeded`) until you delete some. A machine from a snapshot gets at least that snapshot's storage.

`exec` returns output when the command ends — it does not stream. Run long jobs in the background or in `tmux`.

## Scopes

| Scope | Allows |
|---|---|
| `machines:read` | list/get machines, operations, metrics, usage, connection-info, machine vault |
| `machines:write` | create, start, stop, pause, resume, timeout, labels, exec, files, SSH, ports, desktop, wake |
| `machines:delete` | delete machines |
| `images:read` | list/get snapshots, read snapshot files, resolve snapshot names |
| `images:write` | save snapshots |
| `images:delete` | delete snapshots |

`:write` and `:delete` include `:read`. Give `images:read` to keys that create machines from snapshot **names**. Keys cannot create keys; key/Vault/org/session management is sign-in only, and revoking a key also ends the SSH certificates it issued.

## Errors

Errors use the HTTP status plus `{"error":{"code","message","requestId","retryable","operationId"}}`.

| Status | Codes | What to do |
|---|---|---|
| 400 | `bad_request`, `spec_not_allowed`, `invalid_guest_user` | Fix the request; drop size fields |
| 401 | `unauthenticated`, `api_key_expired`, `api_key_revoked` | Fix the key |
| 403 | `permission_denied`, `insufficient_scope` | Wrong scope, or a session-only route |
| 404 | `not_found` | Wrong ID/name |
| 409 | `operation_conflict`, `idempotency_conflict`, `machine_not_running` | Wait for `operationId`; or start/resume the machine; or use a new idempotency key |
| 429 | `quota_exceeded` | Delete machines/snapshots or reduce concurrency; retry later (`retryable`) |
| 502/503/504 | `no_capacity`, `host_unavailable` | Usually retryable with backoff |
| — | `network_error`, `request_timeout`, `operation_timeout`, `is_a_directory` | Client-side conditions |

`retryable: true` means the same request may succeed later. Retry with backoff only those (and 502/503/504/network errors). Never blind-retry `exec` (it runs the command again) — it takes no idempotency key. Retrying an idempotent call with the same key is safe and replays the response.

Failed operations carry `error.code`/`error.message` (e.g. `no_capacity` while creating): read it before retrying.

## SDK ↔ HTTP map

| SDK | HTTP |
|---|---|
| `Sandbox.create` | `POST /v1/machines` |
| `pause` / `resume` | `POST /v1/machines/{id}/suspend` / `…/resume` |
| `stop` | `POST /v1/machines/{id}/stop` |
| `kill` | `DELETE /v1/machines/{id}` |
| `commands.run` | `POST /v1/machines/{id}/exec` |
| `files.*` | `GET /v1/machines/{id}/files` + `exec` |
| `sshCredentials` | `POST /v1/machines/{id}/connections` |
| `desktop.start` | `POST /v1/machines/{id}/desktop` |
| `desktop.streamUrl` / `revokeStreamUrls` | `POST` / `DELETE /v1/machines/{id}/desktop/stream` |
| `getMetrics` | `GET /v1/machines/{id}/metrics` |
| `getUsage` | `GET /v1/machines/{id}/usage` |
| `Sandbox.usage` | `GET /v1/usage` |
| `createSnapshot` | `POST /v1/machines/{id}/snapshots` |
| `listSnapshots` / `getSnapshot` / `deleteSnapshot` | `GET /v1/snapshots`, `GET`/`DELETE /v1/snapshots/{id}` |
