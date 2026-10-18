# TypeScript SDK — `@insforge/instabox-sdk`

Version documented: 0.5.0. Needs Node 18+, Bun or Deno (global `fetch`).

```bash
npm install @insforge/instabox-sdk
export INSTABOX_API_KEY=ibk_...
export INSTABOX_API_URL=https://api.instabox.sh   # optional
```

```ts
import { Sandbox } from '@insforge/instabox-sdk'

const sbx = await Sandbox.create('universal', { metadata: { task: 'review' } })
```

Every static call also takes `apiKey`/`apiUrl`, which win over the environment. A `Sandbox` object keeps its connection, so its instance methods take no key. With no key at all, calls throw `InstaboxAuthError` with `code: 'missing_api_key'` (`status: 0`) before any request.

## Connection options

| Option | Type | Default |
|---|---|---|
| `apiKey` | string | env `INSTABOX_API_KEY` |
| `apiUrl` | string | env `INSTABOX_API_URL`, else `https://api.instabox.sh` |
| `requestTimeoutMs` | number | 60 000 per HTTP request; a command gets its own timeout + 30 000 |
| `operationTimeoutMs` | number | 600 000 for create/pause/resume/kill waits |
| `fetch` | typeof fetch | the global `fetch` |
| `pollIntervalMs` | number | 250 (grows 1.5× to 1 s) |
| `retryDelayMs` | number | 250 |

Reads and idempotent changes are retried up to 3× with backoff on 502/503/504 and network errors.

## Scopes a key needs

| Scope | Allows |
|---|---|
| `machines:read` | `list`, `getInfo`, `isRunning`, `vault`, `getMetrics`, `getUsage`, `Sandbox.usage` |
| `machines:write` | `create`, `connect` (resume), `pause`, `resume`, `stop`, `setTimeout`, `setAutoSuspend`, `setMetadata`, `disableVault`, `pushVault`, `commands`, `files`, `sshCredentials` |
| `machines:delete` | `kill` |
| `images:read` | snapshot name resolution, `listSnapshots`, `getSnapshot` |
| `images:write` | `createSnapshot` |
| `images:delete` | `deleteSnapshot` |

`:write`/`:delete` include `:read`. Creating from a snapshot **name** also needs `images:read`. Anything outside the key's scopes throws `InstaboxAuthError` (`403 insufficient_scope`).

## Create, connect, list, kill

```ts
Sandbox.create(opts?: SandboxOpts): Promise<Sandbox>
Sandbox.create(template: string, opts?: SandboxOpts): Promise<Sandbox>
Sandbox.connect(sandboxId: string, opts?: SandboxConnectOpts): Promise<Sandbox>
Sandbox.list(opts?: SandboxListOpts): Promise<SandboxInfo[]>
Sandbox.kill(sandboxId: string, opts?: ConnectionOptions): Promise<boolean>
```

`template` is a template id (`universal`), a private snapshot name, or a snapshot id (`sn_...`). Template ids win over snapshot names. Default is `agent-browser` (`DEFAULT_TEMPLATE`), or `universal` (`FALLBACK_TEMPLATE`) on a server without it. `create` resolves once the machine runs (a snapshot still uploading is waited for, up to `operationTimeoutMs`).

`SandboxOpts` = connection options plus:

| Option | Type | Default |
|---|---|---|
| `name` | string | `sbx-…`; lowercase letters, digits, `-` |
| `metadata` | Record<string,string> | none |
| `envs` | Record<string,string> | none; merged into every `commands.run` of this object (client side) |
| `timeoutMs` | number | none; server pauses/kills 60 s–24 h after creation (4 h cap without manual lifecycle) |
| `onTimeout` | `'pause' \| 'kill'` | `'pause'` |
| `archiveMs` | number | none; stop and archive after this long, besides the timeout |
| `autoSuspendMs` | number | 30 min; idle pause 2 min–24 h, `0` never. Only honoured with manual lifecycle |
| `vcpus`, `memMiB`, `diskGiB`, `rootDiskGiB` | number | the template's. `api.instabox.sh` has fixed sizes and refuses these with `400 spec_not_allowed` |
| `vault` | boolean | `true`; `false` keeps the account's Vault items out for good |

Times are sent as whole seconds.

- `connect` attaches and resumes a paused/stopped machine; `{ resume: false }` attaches without waking it.
- `list` returns every page; `metadata` keeps machines with every given key and value.
- `kill` deletes the machine and its disks; `false` if it was already gone.

## Snapshots

```ts
Sandbox.listSnapshots(opts?: ConnectionOptions): Promise<Snapshot[]>
Sandbox.getSnapshot(snapshotId: string, opts?: ConnectionOptions): Promise<Snapshot>
Sandbox.deleteSnapshot(snapshotId: string, opts?: ConnectionOptions): Promise<boolean>
sbx.createSnapshot(opts: CreateSnapshotOpts): Promise<Snapshot>
```

`CreateSnapshotOpts`: `name` (required), `description`, `rootOnly`. From a running machine the snapshot comes back `status: 'pending'` and turns `ready` when uploaded. Copying a machine does **not** copy its settings:

```ts
const snap = await sbx.createSnapshot({ name: 'my-setup' })
const copy = await Sandbox.create(snap.id, { vault: false })
```

## The Sandbox object

| Member | Returns | What it does |
|---|---|---|
| `sandboxId` | string | The machine id, `m_...` |
| `getInfo()` | `Promise<SandboxInfo>` | Fresh state from the server |
| `isRunning()` | `Promise<boolean>` | `state === 'running'` |
| `pause()` | `Promise<void>` | Suspend, keeping memory and processes |
| `resume()` | `Promise<void>` | Resume a paused machine or start a stopped one |
| `stop()` | `Promise<void>` | Shut down; processes end, `/data` kept |
| `setTimeout(ms, { onTimeout? })` | `Promise<void>` | Pause/kill in `ms` (60 s–24 h); `0` clears |
| `setAutoSuspend(idleMs)` | `Promise<void>` | Idle pause 2 min–24 h; `0` off; kept across pause/resume |
| `setMetadata(record)` | `Promise<void>` | Replace labels; `{}` clears |
| `createSnapshot(opts)` | `Promise<Snapshot>` | Save its disks |
| `getMetrics(opts?)` | `Promise<SandboxMetrics[]>` | CPU/memory samples, oldest first |
| `getUsage(opts?)` | `Promise<SandboxUsage>` | Usage over a window |
| `sshCredentials(publicKey, { ttlSeconds? })` | `Promise<SshCredentials>` | Short-lived SSH certificate |
| `vault()` | `Promise<MachineVault>` | Whether it takes the Vault, items, last write |
| `pushVault()` | `Promise<VaultApplied>` | Write the items in now |
| `disableVault()` | `Promise<void>` | Keep the Vault out for good |
| `kill()` | `Promise<boolean>` | Delete it and its disks; `false` if gone |
| `commands` / `files` / `desktop` | `Commands` / `Files` / `Desktop` | See below |

Lifecycle calls wait for the server operation, up to `operationTimeoutMs`.

`SandboxInfo`: `sandboxId`, `templateId`, `snapshotId?`, `name`, `metadata`, `vault`, `startedAt`, `endAt?`, `archiveAt?`, `onTimeout`, `autoSuspendMs?`, `state`, `machine` (raw API object). `state` is one of `creating starting running stopping stopped suspending suspended resuming deleting deleted error` (`suspended` = paused).

`SshCredentials`: `host`, `port`, `username` (the machine id), `certificate` (save as `-cert.pub`), `knownHostsLine`, `expiresAt`, `connectionId`. Machine must be running; `ttlSeconds` 1–86 400, default 1 hour.

## `sbx.commands`

```ts
run(cmd: string, opts?: CommandOptions & { background?: false }): Promise<CommandResult>
run(cmd: string, opts: CommandOptions & { background: true }): Promise<CommandHandle>
exec(cmd: string, opts?: CommandOptions): Promise<CommandResult>   // internal, no throw
```

| Option | Type | Default |
|---|---|---|
| `cwd` | string | the server's: `HOME` = `/data/home` |
| `envs` | Record<string,string> | none; merged over the object's `envs` |
| `timeoutMs` | number | the server's; at most 600 000 |
| `stdin` | string | none; ≤1 MiB (`MAX_STDIN_BYTES`) |
| `onStdout` / `onStderr` | `(data: string) => unknown` | called once with the whole stream when the command ends |
| `background` | boolean | `false`; `true` detaches and returns at once |

`CommandResult`: `{ stdout, stderr, exitCode, timedOut, truncated, error? }`. Each stream is cut at 1 MiB and `truncated` says so. Output is not streamed.

A non-zero exit throws `CommandExitError` (carries the same fields). A command past `timeoutMs` throws it with `timedOut: true` and exit code 124.

```ts
import { CommandExitError } from '@insforge/instabox-sdk'
try {
  await sbx.commands.run('exit 3')
} catch (e) {
  if (e instanceof CommandExitError) console.log(e.exitCode, e.stderr)
}
```

`background: true` returns a `CommandHandle`: `pid` (the shell leading its process group) and `kill()`, which SIGTERMs everything it started and returns `false` if all had already exited.

```ts
const server = await sbx.commands.run('node server.js', { background: true })
await server.kill()
```

Commands are never retried. Run long jobs in the background or in `tmux`; `run` is not a TTY.

## `sbx.files`

```ts
read(path, { format?: 'text' }): Promise<string>
read(path, { format: 'bytes' }): Promise<Uint8Array>
write(path, data: string | Uint8Array): Promise<{ path: string }>
list(path): Promise<EntryInfo[]>          // { name, path, type: 'file' | 'dir' }
remove(path): Promise<void>
exists(path): Promise<boolean>
```

- `write` creates parent directories and replaces the file atomically; writing to a directory throws `is_a_directory`.
- `remove` deletes files or directories recursively; a missing path is fine.
- `list` is not recursive.
- Files travel as base64 through the command channel, so they need the same scope as commands. Max 10 MiB per read or write (`MAX_FILE_BYTES`). Relative paths start at `HOME` (`/data/home`, persistent).

## `sbx.desktop`

```ts
start(opts?: { width?: number; height?: number }): Promise<DesktopStatus>
status(): Promise<DesktopStatus>
screenshot(): Promise<Uint8Array>                    // PNG of the whole screen
click(x, y, opts?: { button?: 'left'|'right'|'middle'; double?: boolean }): Promise<void>
move(x, y): Promise<void>
drag(from: [number, number], to: [number, number]): Promise<void>
scroll(opts: { direction: 'up'|'down'|'left'|'right'; amount?: number }): Promise<void>
type(text: string, opts?: { delayMs?: number }): Promise<void>
press(keys: string | string[]): Promise<void>        // 'Enter', 'a', 'F5', ['ctrl','l']
open(url: string): Promise<void>                     // http/https in the desktop's browser
cursorPosition(): Promise<{ x: number; y: number }>
streamUrl(opts?: { viewOnly?: boolean; ttlSeconds?: number }): Promise<{ url: string; expiresAt: string }>
revokeStreamUrls(): Promise<void>
```

- `start` is safe to call again; it leaves a running desktop alone. A template without the desktop installs it first (about 30 s). Screen 800–2560 × 600–1600, default 1280 × 800. The desktop runs on X display `:1` (`DESKTOP_DISPLAY`).
- Input and screenshots run commands in the machine, so a failure throws `CommandExitError`.
- `streamUrl`: `viewOnly` defaults true (server drops viewer input); `ttlSeconds` 60–86 400, default 3600. Anyone with the link can watch until it expires — no account needed. Expiry stops new connections only; `revokeStreamUrls()` ends every link and drops open viewers within seconds. Deleting the machine does the same.

Agent loop sketch:

```ts
await sbx.desktop.start({ width: 1280, height: 800 })
for (let step = 0; step < 20; step++) {
  const png = await sbx.desktop.screenshot()
  const action = await decide(png)            // your vision model
  if (action.kind === 'click') await sbx.desktop.click(action.x, action.y)
  if (action.kind === 'type') await sbx.desktop.type(action.text)
  if (action.kind === 'press') await sbx.desktop.press(action.keys)
  if (action.kind === 'done') break
}
```

Keep the API key on your server; mint a fresh `streamUrl` per user and revoke when their access ends. Tag machines with metadata (e.g. `{ customer: 'acme' }`) and find them with `Sandbox.list({ metadata })`.

## Metrics and usage

```ts
sbx.getMetrics(opts?: { since?: Date }): Promise<SandboxMetrics[]>
Sandbox.getMetrics(id, opts?): Promise<SandboxMetrics[]>
sbx.getUsage(opts?: { from?: Date; to?: Date }): Promise<SandboxUsage>
Sandbox.getUsage(id, opts?): Promise<SandboxUsage>
Sandbox.usage(opts?): Promise<Usage>
```

`SandboxMetrics`: `timestamp: Date`, `cpuUsedPct` (0–100), `cpuCount`, `memUsed`, `memTotal`, `diskTotal` (bytes). One sample per 30 s, oldest first; `since` defaults to 5 minutes ago, at most 24 h back; empty while not running; the first sample of a new machine appears after ~90 s. `diskUsed` is not reported yet.

`SandboxUsage`: `from`, `to`, `runningSeconds`, `vcpuSeconds`, `memGiBSeconds`, `diskGiBSeconds`. Default window is the current UTC month; `to` at most 366 days after `from`.

`Usage`: `computedAt` (string \| null), `logicalBytes`, `storedBytes`, `exclusiveBytes`, `machines`, `snapshots`, `limits` (`maxMachines`, `maxSnapshots`, `maxStoredGiB`, `machineSpec?`, `liveSnapshots?`, `vault?`), `storage?` (`machines[]` with `id`, `name`, `state`, `sizeBytes`, `diskBytes`, `snapshots`, `snapshotBytes`, plus `deletedMachineSnapshots`, `deletedMachineSnapshotBytes`).

## Errors

| Class | When |
|---|---|
| `InstaboxError` | Base class: `status`, `code`, `message`, `requestId`, `retryable`, `operationId` |
| `InstaboxAuthError` | 401/403 — bad/revoked key or missing scope; `missing_api_key` with `status: 0` when no key exists |
| `InstaboxQuotaError` | 429, e.g. `quota_exceeded` |
| `InstaboxTimeoutError` | A request or operation took too long |
| `CommandExitError` | Non-zero exit; also `stdout`, `stderr`, `exitCode`, `timedOut`, `truncated`, `error` |

A failed operation (e.g. `no_capacity` while creating) throws `InstaboxError` with the operation's `code` and `operationId`.

| Code | Meaning |
|---|---|
| `missing_api_key` | No key in options or environment |
| `insufficient_scope` | Key lacks a scope (403) |
| `not_found` | No such machine or snapshot |
| `operation_conflict` | Another operation runs (409); `operationId` names it |
| `quota_exceeded` | Account limit reached (429) |
| `spec_not_allowed` | A size option on a fixed-size service (400) |
| `is_a_directory` | `files.write` to a directory |
| `request_timeout`, `operation_timeout` | Took too long |
| `network_error` | Request never reached the API |

## Types and constants

`ConnectionOptions`, `SandboxOpts`, `SandboxConnectOpts`, `SandboxListOpts`, `SandboxInfo`, `Machine`, `MachineSpec`, `MachineState`, `OnTimeout`, `CreateSnapshotOpts`, `Snapshot`, `SandboxMetrics`, `SandboxMetricsOpts`, `SandboxUsage`, `SandboxUsageOpts`, `Usage`, `UsageLimits`, `UsageStorage`, `UsageMachineStorage`, `SshCredentials`, `CommandOptions`, `CommandResult`, `CommandHandle`, `EntryInfo`, `WriteInfo`, `DesktopStatus`, `DesktopStream`, `MouseButton`, `ScrollDirection`, `MachineVault`, `MachineVaultItem`, `VaultApplied`, `Template`, `TemplateRef`, `Operation`, `ApiError`.

Constants: `DEFAULT_API_URL`, `DEFAULT_TEMPLATE` (`agent-browser`), `FALLBACK_TEMPLATE` (`universal`), `MAX_FILE_BYTES` (10 MiB), `MAX_STDIN_BYTES` (1 MiB), `DESKTOP_DISPLAY` (`:1`).
