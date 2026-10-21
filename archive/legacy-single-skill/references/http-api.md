# InstaBox HTTP API

Every documented endpoint, with fields. The machine-readable spec is at `https://api.instabox.sh/v1/openapi.json`.

- **Base URL:** `https://api.instabox.sh`
- **Auth:** `X-API-Key: ibk_...` or `Authorization: Bearer ibk_...`
- **Bodies:** JSON in and out; times are RFC 3339 UTC.
- **IDs:** machines `m_…`, snapshots `sn_…`, operations `op_…`, SSH tokens `cn_…`, SSH secrets `ibssh_…`, API keys `ibk_…`.

```bash
export INSTABOX_API_URL=https://api.instabox.sh
H="X-API-Key: $INSTABOX_API_KEY"
```

## Conventions

**Operations.** Create, start, stop, suspend, resume and delete return `202 Accepted` with an operation. A machine runs one operation at a time; wait for it before the next change.

**Idempotency.** Endpoints marked *idempotent* require `Idempotency-Key: <unique string>`. A retry with the same key replays the stored response; the same key with a different request is `409 idempotency_conflict`. Keys are kept 7 days. Missing key: `400`.

```bash
KEY=$(uuidgen)   # macOS/Linux; PowerShell: [guid]::NewGuid().ToString()
```

**Pagination.** Machine lists take `limit` and `cursor`; the reply's `nextCursor` is the next page's `cursor` (null at the end).

**Errors.** `{"error":{"code","message","requestId","retryable","operationId"}}`. See [concepts.md](concepts.md#errors).

## Endpoint index

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/machines` | Create a machine (idempotent) |
| GET | `/v1/machines` | List machines |
| GET | `/v1/machines/{id}` | Get one (ID or name) |
| PATCH | `/v1/machines/{id}` | Timeout, idle pause, labels (idempotent) |
| DELETE | `/v1/machines/{id}` | Delete it and its disks (idempotent) |
| POST | `/v1/machines/{id}/start` | Start a stopped machine (idempotent) |
| POST | `/v1/machines/{id}/stop` | Stop it (idempotent) |
| POST | `/v1/machines/{id}/suspend` | Pause it (idempotent) |
| POST | `/v1/machines/{id}/resume` | Resume it (idempotent) |
| GET | `/v1/operations/{id}` | Get / long-poll an operation |
| POST | `/v1/machines/{id}/exec` | Run a command |
| GET | `/v1/machines/{id}/files` | List a directory or read a text file |
| POST | `/v1/machines/{id}/snapshots` | Save a snapshot (idempotent) |
| GET | `/v1/snapshots` | List snapshots |
| GET | `/v1/snapshots/{id}` | Get a snapshot |
| GET | `/v1/snapshots/{id}/files` | Read a snapshot's files |
| DELETE | `/v1/snapshots/{id}` | Delete a snapshot (idempotent) |
| POST | `/v1/machines/{id}/ssh-tokens` | Create an SSH token |
| GET | `/v1/machines/{id}/ssh-tokens` | List SSH tokens |
| DELETE | `/v1/machines/{id}/ssh-tokens/{tokenID}` | Revoke one token |
| DELETE | `/v1/machines/{id}/ssh-tokens` | Revoke all tokens |
| POST | `/v1/machines/{id}/connections` | Get an SSH certificate (idempotent) |
| GET | `/v1/machines/{id}/connection-info` | Host, port, username, host CA |
| POST | `/v1/machines/{id}/ports` | Publish a port |
| GET | `/v1/machines/{id}/ports` | List a machine's ports |
| GET | `/v1/ports` | List all ports |
| DELETE | `/v1/machines/{id}/ports/{port}` | Unpublish a port |
| POST | `/v1/machines/{id}/desktop` | Desktop status / install / start / takeover |
| POST | `/v1/machines/{id}/desktop/stream` | Mint a desktop viewer link |
| DELETE | `/v1/machines/{id}/desktop/stream` | Revoke every desktop link |
| POST | `/v1/machines/{id}/wake` | Wake an idle-paused machine |
| GET | `/v1/machines/{id}/metrics` | CPU/memory samples |
| GET | `/v1/machines/{id}/usage` | Per-machine usage (billing) |
| GET | `/v1/machines/{id}/vault` | What the Vault wrote in |
| POST | `/v1/machines/{id}/vault` | Push Vault items now |
| GET | `/v1/templates` | Available templates |
| GET | `/v1/usage` | Account counts, storage, limits |
| GET | `/v1/me` | Who the key belongs to |
| GET | `/v1/openapi.json` | The spec |

Routes **not** available to API keys (sign-in session only): `GET/POST /v1/keys`, `DELETE /v1/keys/{id}`, `GET/PUT/PATCH/DELETE /v1/vault…`, `/v1/orgs…`, `/v1/sessions…`. With an API key they answer `403 permission_denied`.

## The machine object

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `m_` + 26 characters |
| `name` | string | Unique among your machines |
| `state` | string | `creating`, `starting`, `running`, `stopping`, `stopped`, `suspending`, `suspended` (paused), `resuming`, `deleting`, `error` |
| `desiredState` | string | `running` or `stopped` |
| `revision` | integer | Bumps on every change |
| `operationId` | string \| null | The operation in progress |
| `template` | object | `{id, version, digest}` it started from |
| `spec` | object | `{vcpus, memMiB, persistentDiskGiB, rootDiskGiB}` |
| `storage` | object | `{sizeGiB, mountPath:"/data", persistent, synced, snapshotSeq}` |
| `runtime` | object | `{ready, processesPreserved}` |
| `timeoutAt` | string \| null | When the timeout fires |
| `onTimeout` | `"pause"` \| `"kill"` | What the timeout does |
| `autoSuspendAfterSeconds` | integer \| null | Idle seconds before pause; null = off |
| `autoSuspendedAt` | string | When it paused itself (when it did) |
| `metadata` | object | Your labels (strings) |
| `vault` | boolean | Whether it receives the Vault |
| `guestUser` | string | Linux user inside (`user`, or `dev` on older templates) |
| `createdAt`, `updatedAt` | string | Timestamps |

### Create a machine

`POST /v1/machines` — *idempotent*

| Field | Type | Notes |
|---|---|---|
| `name` | string | **required**; 1–63 lowercase letters, digits, `-`; starts with a letter or digit |
| `templateId` | string | e.g. `universal`; give this or `snapshotId` |
| `snapshotId` | string | Start from one of your snapshots instead |
| `guestUser` | string | ≤32 of `a-z0-9_-`, starts with a letter/`_`; reserved names → `400 invalid_guest_user`; default `user` |
| `timeoutSeconds` | integer | 60–86400; capped at 14400 without manual lifecycle; `0` clears |
| `onTimeout` | `"pause"` \| `"kill"` | Default `pause` |
| `autoSuspendAfterSeconds` | integer | 120–86400, `0` never; honoured only with manual lifecycle, otherwise fixed at 1800 |
| `metadata` | object | ≤32 string keys |
| `desiredState` | `"running"` \| `"stopped"` | `stopped` stops it after setup |
| `archiveSeconds` | integer | 60–86400; stop it then, independent of the timeout |

Sizes are fixed: sending `vcpus`, `memMiB`, `persistentDiskGiB` or `rootDiskGiB` → `400 spec_not_allowed`.

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines" -H "$H" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"name":"dev","templateId":"universal","timeoutSeconds":1800,"metadata":{"task":"review"}}'
```

```json
202 Accepted
{"id":"op_7xk2mq4tz5rbw3vn6pd2hs4jye","machineId":"m_agqteugyy5px6hzeadbh4ldjo4",
 "type":"create","state":"queued","error":null,
 "createdAt":"2026-10-13T09:12:04Z","updatedAt":"2026-10-13T09:12:04Z"}
```

### List machines

`GET /v1/machines?metadata=task:review&limit=50&cursor=...`

`metadata` is `key:value`; repeat it to require several. Reply: `{"machines":[…],"nextCursor":null}`.

### Get a machine

`GET /v1/machines/{id}` — `{id}` is the ID or the name. Returns the machine object.

### Update a machine

`PATCH /v1/machines/{id}` — *idempotent*; any state, applied at once. Omitted fields unchanged.

| Field | Type | Notes |
|---|---|---|
| `timeoutSeconds` | integer | 60–86400 (4 h max without manual lifecycle); `0` clears |
| `onTimeout` | `"pause"` \| `"kill"` | |
| `autoSuspendAfterSeconds` | integer | 120–86400; `0` off; fixed 1800 without manual lifecycle |
| `metadata` | object | Replaces labels; `{}` clears |

### Delete a machine

`DELETE /v1/machines/{id}` — *idempotent*; `202` with a `delete` operation. Snapshots survive.

## Lifecycle

All four are *idempotent* and answer `202` with an operation (`type` is `start`/`stop`/`suspend`/`resume`).

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/start"   -H "$H" -H "Idempotency-Key: $(uuidgen)"
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/stop"    -H "$H" -H "Idempotency-Key: $(uuidgen)"
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/suspend" -H "$H" -H "Idempotency-Key: $(uuidgen)"
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/resume"  -H "$H" -H "Idempotency-Key: $(uuidgen)"
```

- `start` boots a stopped machine; on a paused one it resumes (or boots fresh if processes can't return).
- `stop` takes an optional body `{"timeoutSeconds": 0..600}` — seconds to wait for a clean shutdown (default 60). A paused machine cannot be stopped.
- `suspend` pauses, keeping memory and running programs.
- `resume` continues a paused machine where it left off.

## Operations

`GET /v1/operations/{id}?wait=25s`

`wait` (max 30s) long-polls until the operation changes or finishes — loop on it instead of sleeping.

| Field | Meaning |
|---|---|
| `id` | `op_…` |
| `machineId` | The machine |
| `type` | `create`, `start`, `stop`, `suspend`, `resume`, `delete` |
| `state` | `queued`, `running`, `succeeded`, `failed` |
| `phase` | Progress, e.g. `booting`, `snapshotting` |
| `error` | `{code, message}` when failed |
| `machine` | The machine, once succeeded |

```bash
while :; do
  s=$(curl -s "$INSTABOX_API_URL/v1/operations/$OP?wait=25s" -H "$H")
  st=$(echo "$s" | jq -r .state)
  [ "$st" = succeeded ] && break
  [ "$st" = failed ] && { echo "$s" | jq -r .error.message; exit 1; }
done
```

## Commands and files

Both need a **running** machine. A machine paused by its idle timer is woken first; any other non-running state is `409 machine_not_running`. At most 32 `exec`-class requests run at once per account (commands, file reads, desktop, port-forward, vault push); more get a retryable `429 quota_exceeded`.

### Run a command

`POST /v1/machines/{id}/exec`

| Field | Type | Notes |
|---|---|---|
| `cmd` | string | **required**; run with `bash -lc` as the guest user |
| `cwd` | string | Default `/data/home` |
| `envs` | object | Extra environment variables |
| `stdin` | string | ≤1 MiB, then EOF |
| `timeoutSeconds` | integer | Default 60, max 600; on expiry exit code 124 |

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/exec" -H "$H" \
  -H 'Content-Type: application/json' -d '{"cmd":"echo hello"}'
```

```json
200 OK
{"stdout":"hello\n","stderr":"","exitCode":0,"timedOut":false,"truncated":false}
```

A non-zero exit is still `200`: check `exitCode`. Output is not streamed; each stream is cut at 1 MiB (`truncated: true`). No `Idempotency-Key`: a retry runs the command again.

### Read a file or directory

`GET /v1/machines/{id}/files?path=/data/home`

Lists a directory (≤5000 entries) or returns a text file (≤256 KiB), read **as root**.

```json
{"path":"/data/home","type":"dir","size":0,"mode":"drwxr-xr-x",
 "modTime":"2026-10-13T09:30:12Z",
 "entries":[{"name":"app","type":"dir","size":0,"mode":"drwxr-xr-x","modTime":"..."},
            {"name":"notes.txt","type":"file","size":5,"mode":"-rw-r--r--","modTime":"..."}]}
```

Entries also carry `target` for symlinks. Writing files is an SDK-only convenience (`sbx.files.write`) built on `exec`; over HTTP use `exec` with base64 or a heredoc.

## Snapshots

A snapshot holds installed software and everything under `/data` — not memory or processes. It is private to you.

| Field | Meaning |
|---|---|
| `id` | `sn_…` |
| `name` | Unique among your snapshots |
| `status` | `pending` (uploading), `ready`, `failed` |
| `sourceMachineId` | The machine it came from |
| `rootSizeBytes` / `dataSizeBytes` | Saved system disk / `/data` sizes |
| `template`, `description`, `createdAt` | |

### Save

`POST /v1/machines/{id}/snapshots` — *idempotent*

| Field | Type | Notes |
|---|---|---|
| `name` | string | **required**; lowercase letters, digits, `-` |
| `description` | string | Shown with the snapshot |
| `rootOnly` | boolean | Installed software only; new machines get an empty home |

A stopped machine is saved at once (`201`). A running machine, where supported, is saved live (`202`, `pending` until uploaded). Where live save is not supported, saving stops the machine first.

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/snapshots" -H "$H" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"name":"dev-base"}'
```

### Read and delete

```bash
curl -s "$INSTABOX_API_URL/v1/snapshots" -H "$H"                       # oldest first
curl -s "$INSTABOX_API_URL/v1/snapshots/$SN" -H "$H"
curl -s "$INSTABOX_API_URL/v1/snapshots/$SN/files?path=/etc" -H "$H"   # saved software only
curl -s -X DELETE "$INSTABOX_API_URL/v1/snapshots/$SN" -H "$H" -H "Idempotency-Key: $(uuidgen)"
```

`GET /v1/snapshots/{id}/files` does not show `/data`. Deleting a snapshot leaves machines created from it alone.

## SSH

### Connection info

`GET /v1/machines/{id}/connection-info` — no side effects: `{machineId, transport:"ssh", host, port, username, hostTrust:{type:"ca", publicKey, principals}, capabilities}`.

### Create an SSH token

`POST /v1/machines/{id}/ssh-tokens`

| Field | Type | Notes |
|---|---|---|
| `name` | string | A label to recognize it |
| `ttlSeconds` | integer | Default 7 days, max 30 days |

```json
201 Created
{"id":"cn_k3wq7xz2mb4tn5rd6vh2pj4sye","name":"laptop","machineId":"m_...",
 "host":"api.instabox.sh","port":2222,"token":"ibssh_...",
 "command":"ssh -p 2222 ibssh_...@api.instabox.sh",
 "expiresAt":"2026-10-20T10:31:07Z","hostKeyFingerprint":"SHA256:..."}
```

The token is shown **only** in this response. No `Idempotency-Key`: a retry makes another token. Use it as `ssh -p 2222 ibssh_...@api.instabox.sh`.

### List and revoke

```bash
curl -s "$INSTABOX_API_URL/v1/machines/$M/ssh-tokens" -H "$H"                    # no secrets
curl -s -X DELETE "$INSTABOX_API_URL/v1/machines/$M/ssh-tokens/$TOKEN" -H "$H"   # 204
curl -s -X DELETE "$INSTABOX_API_URL/v1/machines/$M/ssh-tokens" -H "$H"          # {"revoked":2}
```

### Get an SSH certificate

`POST /v1/machines/{id}/connections` — *idempotent*

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/connections" -H "$H" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d "{\"publicKey\": \"$(cat ~/.ssh/id_ed25519.pub)\", \"ttlSeconds\": 3600}"
```

Body: `publicKey` (required), `ttlSeconds` (default 3600, max 86400). Reply `201`:

```json
{"id":"cn_...","machineId":"m_...","transport":"ssh","host":"api.instabox.sh","port":2222,
 "username":"m_...","certificate":"ssh-ed25519-cert-v01@openssh.com AAAA...",
 "expiresAt":"2026-10-13T11:31:07Z",
 "hostTrust":{"type":"ca","publicKey":"ssh-ed25519 AAAA...","principals":["api.instabox.sh"]}}
```

Save `certificate` as `<key>-cert.pub` next to the private key, add a known-hosts line for the host CA, then `ssh -p 2222 <username>@<host>`. The machine must be running or idle-paused (it is woken). Not supported: agent forwarding, X11, remote forwarding.

## Public ports

Anyone with the URL reaches the whole service on that port until you unpublish. Up to 16 per machine.

| Field | Type | Notes |
|---|---|---|
| `port` | integer | **required**; the port your server listens on |
| `name` | string | Display name; default `Port N` |

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/ports" -H "$H" \
  -H 'Content-Type: application/json' -d '{"port":3000,"name":"Web app"}'
# 201 (new) or 200 (republish / rename); the URL stays the same for a port
curl -s "$INSTABOX_API_URL/v1/machines/$M/ports" -H "$H"     # {"enabled":true,"ports":[...]}
curl -s "$INSTABOX_API_URL/v1/ports" -H "$H"                # all machines
curl -s -X DELETE "$INSTABOX_API_URL/v1/machines/$M/ports/3000" -H "$H"   # 204
```

```json
{"id":"pv-...","machineId":"m_...","port":3000,"name":"Web app",
 "url":"https://3000-agqteugyy5px6hzeadbh4ldjo4.instabox.tech","createdAt":"..."}
```

A visit wakes an idle-paused machine and waits for it to run. A machine you paused/stopped, or that hit its timeout, returns 503 until you resume or start it. Publishing does not start your server. No `Idempotency-Key`.

## Desktop

`POST /v1/machines/{id}/desktop`

| Field | Type | Notes |
|---|---|---|
| `action` | string | `status` (default), `install`, `start`, `takeover`, `handback` |
| `width` | integer | 800–2560, default 1280 (for `start`) |
| `height` | integer | 600–1600, default 800 (for `start`) |

`status` returns `{installed, installing, running, failed, agentPausable, controller, yours?, log?}`. `start` leaves a running desktop alone; a template without the desktop installs it first (about 30 s). `takeover`/`handback` move control between the agent and a human viewer.

```bash
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/desktop" -H "$H" \
  -H 'Content-Type: application/json' -d '{"action":"start","width":1280,"height":800}'
```

**Share a link** — `POST /v1/machines/{id}/desktop/stream` with `{viewOnly, ttlSeconds}` (`viewOnly` defaults true; `ttlSeconds` 60–86400, default 3600):

```json
{"url":"https://dashboard.instabox.sh/desktop/m_...#token=...","expiresAt":"..."}
```

The link opens a dashboard full-screen viewer; anyone with it can watch (or control, when `viewOnly:false`) without an account. It is not an API key. Expiry stops new connections; `DELETE /v1/machines/{id}/desktop/stream` revokes every link and drops open sessions within a few seconds. Both desktop calls need `machines:write`.

Screen automation (click, type, screenshot, scroll) is **SDK-only**: `sbx.desktop.*`. Over HTTP the raw VNC stream is `GET /v1/machines/{id}/vnc` (WebSocket upgrade, `machines:write`), and `GET /v1/machines/{id}/terminal` is a WebSocket PTY.

## Metrics, usage and wake

```bash
curl -s "$INSTABOX_API_URL/v1/machines/$M/metrics?since=2026-10-18T00:00:00Z" -H "$H"
curl -s "$INSTABOX_API_URL/v1/machines/$M/usage?from=2026-10-01T00:00:00Z&to=2026-10-18T00:00:00Z" -H "$H"
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/wake" -H "$H"
```

- **metrics:** `{"metrics":[{timestamp,cpuUsedPct,cpuCount,memUsed,memTotal,diskTotal}]}` — one sample per 30 s, oldest first, `since` defaults to 5 minutes ago and may be at most 24 h back. Empty while not running; the first sample of a new machine appears after ~90 s. `diskUsed` is not reported yet.
- **usage:** `{from,to,runningSeconds,vcpuSeconds,memGiBSeconds,diskGiBSeconds}`. Default window is the current UTC month; `to` at most 366 days after `from`. Running time is counted only while running (not paused/stopped); disk counts the whole time the machine existed. A deleted machine's usage stays readable by ID.
- **wake:** records activity on a running machine, or waits up to 45 s for an idle suspend + resume to finish. Does not undo a manual stop/suspend, timeout or archive. No `Idempotency-Key`.

## Vault (machine side)

```bash
curl -s "$INSTABOX_API_URL/v1/machines/$M/vault" -H "$H"      # machines:read
curl -s -X POST "$INSTABOX_API_URL/v1/machines/$M/vault" -H "$H"   # machines:write, push now
```

`GET` returns `{enabled, items:[{name, kind, ...}], applied}` — names only, never values. `POST` writes the current items into the running machine synchronously and returns the same shape. Managing items (`GET /v1/vault`, `PUT /v1/vault/{name}`, …) is sign-in only, never an API key.

## Account

### Templates

`GET /v1/templates` → `{"templates":[{"id","version","description","arch","defaultSpec","capabilities","hidden"}]}`. Several versions of the same id appear; the newest is what `create` uses. The visible ids are `agent-browser`, `universal`, `herdr`, `orca`.

### Usage and limits

`GET /v1/usage`

```json
{"computedAt":"2026-10-18T14:05:20Z","logicalBytes":193273528320,"storedBytes":15177581155,
 "exclusiveBytes":13905339094,"machines":5,"snapshots":1,
 "limits":{"maxMachines":5,"maxSnapshots":10,"maxStoredGiB":200,
           "machineSpec":{"vcpus":4,"memMiB":8192,"persistentDiskGiB":20},
           "liveSnapshots":true,"vault":{"maxItems":100,"maxBytes":262144}},
 "storage":{"machines":[{"id","name","state","sizeBytes","diskBytes","snapshots","snapshotBytes"}]}}
```

`computedAt` is null and `storage` absent before the first measurement (bytes are measured about hourly).

### Me

`GET /v1/me` → `{"userId","login","name","admin","allowedSpecs","manualLifecycle","fixedAutoSuspendSeconds","maxTimeoutSeconds",…}`. Useful for checking `manualLifecycle` before promising a custom idle pause, and for `maxTimeoutSeconds` before a long timeout.

## Beyond the docs pages

These exist in the spec but are not part of the documented API surface; they need a newer server and may change:

`GET /v1/machines/{id}/wake` (documented above), `PUT/DELETE /v1/machines/{id}/activity-leases/{leaseID}` (keep a machine awake during a task, 30–3600 s), `POST /v1/machines/{id}/port-agent` (install `instabox-port` and rotate its credential), `POST /v1/machines/{id}/orca-connections` (single-use Orca runtime ticket), `GET /v1/orgs…`, `/v1/sessions…`. Deprecated aliases: `/v1/images` for `/v1/snapshots`, `imageId` for `snapshotId`.
