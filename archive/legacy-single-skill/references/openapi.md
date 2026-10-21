# OpenAPI and the full route inventory

The spec is served by the API itself:

```bash
curl -s https://api.instabox.sh/v1/openapi.json -H "X-API-Key: $INSTABOX_API_KEY" > openapi.json
```

OpenAPI 3.1.0, title `instabox API`. It is generated from the server, so it is newer than the docs pages: it also lists orgs, sessions and deprecated aliases. Treat the docs pages as the supported contract and the spec as the precise schema source.

## Authentication schemes in the spec

| Scheme | Header | Used by |
|---|---|---|
| `apiKey` | `X-API-Key: ibk_...` (or `Authorization: Bearer ibk_...`) | sandbox, snapshot, operation, template, usage, vault-of-a-machine routes |
| `bearerAuth` | `Authorization: Bearer <access token>` | dashboard/CLI sign-in session (1 h, refresh token 30 days) |
| `sessionCookie` | `instabox_session` cookie | dashboard browser session (non-GET needs `X-Instabox-CSRF` + `Origin`) |
| `portAgent` | `Authorization: ibpv_...` | a machine's own port list/publish/unpublish |

## Route inventory

Documented in [http-api.md](http-api.md) unless marked otherwise.

| Path | Methods |
|---|---|
| `/v1/machines` | GET, POST |
| `/v1/machines/{id}` | GET, PATCH, DELETE |
| `/v1/machines/{id}/start` | POST |
| `/v1/machines/{id}/stop` | POST |
| `/v1/machines/{id}/suspend` | POST |
| `/v1/machines/{id}/resume` | POST |
| `/v1/machines/{id}/exec` | POST |
| `/v1/machines/{id}/files` | GET |
| `/v1/machines/{id}/metrics` | GET |
| `/v1/machines/{id}/usage` | GET |
| `/v1/machines/{id}/wake` | POST |
| `/v1/machines/{id}/connection-info` | GET |
| `/v1/machines/{id}/connections` | POST |
| `/v1/machines/{id}/ssh-tokens` | GET, POST, DELETE |
| `/v1/machines/{id}/ssh-tokens/{tokenID}` | DELETE |
| `/v1/machines/{id}/ports` | GET, POST |
| `/v1/machines/{id}/ports/{port}` | DELETE |
| `/v1/machines/{id}/desktop` | POST |
| `/v1/machines/{id}/desktop/stream` | POST, DELETE |
| `/v1/machines/{id}/vault` | GET, POST |
| `/v1/machines/{id}/snapshots` | POST |
| `/v1/operations/{id}` | GET |
| `/v1/snapshots` | GET |
| `/v1/snapshots/{id}` | GET, DELETE |
| `/v1/snapshots/{id}/files` | GET |
| `/v1/ports` | GET |
| `/v1/templates` | GET |
| `/v1/usage` | GET |
| `/v1/me` | GET |
| `/v1/openapi.json` | GET |
| *Not in the docs pages* | |
| `/v1/machines/{id}/desktop/stream/state` | GET — state behind a stream link |
| `/v1/machines/{id}/desktop/watch` | GET — SSE status while a VNC session is open |
| `/v1/machines/{id}/vnc` | GET — WebSocket RFB stream of the desktop |
| `/v1/machines/{id}/terminal` | GET — WebSocket PTY (`cols`, `rows`, `session`, `wake`) |
| `/v1/machines/{id}/activity-leases/{leaseID}` | PUT, DELETE — keep a machine awake 30–3600 s |
| `/v1/machines/{id}/port-agent` | POST — install `instabox-port`, rotate its credential |
| `/v1/machines/{id}/orca-connections` | POST — single-use Orca runtime ticket (60 s) |
| `/v1/orca/keys` | GET — Orca public keys (no auth needed for trust bootstrap) |
| `/v1/keys`, `/v1/keys/{id}` | GET, POST, DELETE — sign-in only |
| `/v1/vault`, `/v1/vault/{name}` | GET, PUT, PATCH, DELETE — sign-in only |
| `/v1/orgs`, `/v1/orgs/{id}`, `/v1/orgs/{id}/members`, `/v1/orgs/{id}/invites` | org management — sign-in only |
| `/v1/sessions`, `/v1/sessions/{id}` | GET, DELETE — sign-in sessions |
| `/v1/invites/redeem`, `/v1/org-invites/redeem` | POST — redeem an invite |
| `/v1/tunnels/{ticket}` | GET — tunnel entry |
| `/v1/images`, `/v1/images/{id}`, `/v1/images/{id}/files`, `/v1/machines/{id}/images` | deprecated aliases of the snapshot routes |
| `/v1/auth/*` | sign-in, device code, CLI flow, refresh, logout |

## Schemas worth reading in the spec

`Machine`, `MachineSpec`, `MachineState`, `Operation`, `Snapshot`, `Template`, `CreateMachineRequest`, `UpdateMachineRequest`, `DesktopRequest`, `Desktop`, `DesktopStream`, `MachineMetrics`, `MachineUsage`, `Usage`, `UsageLimits`, `MachineVault`, `ActivityLease`, `CreateAPIKeyRequest`, `CreatedAPIKey`, `Error`.

## Compatibility notes

- `imageId` is a deprecated alias for `snapshotId` (sending both must be equal; the reply carries a `Deprecation` header).
- `Op`/`operationId` naming is stable: operations are always `op_…` and machines `m_…`.
- Newer servers add fields (`orgId`, `desktop.controlError`, …). Treat unknown fields as additive and don't reject them.
