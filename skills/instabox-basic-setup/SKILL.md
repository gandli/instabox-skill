---
name: instabox-basic-setup
description: Use when the user wants their instabox setup to use local tokens, git config or editor config — "put my tokens / dotfiles / git config into instabox", "set up my box like my laptop", "move my setup to instabox". Saves credentials as org Secrets with proxy/env modes, grants them to named boxes, copies approved git/editor config, and moves no code (for a repo use `instabox-move-repo`).
metadata:
  installed-by: instabox
---

# Basic setup with org Secrets and sandbox config copies

Use the user's chosen org and sandbox IDs. Secrets are shared within an org, but real-value `env` delivery requires explicit sandbox selection. A `proxy` Secret supplies a placeholder for HTTPS header substitution at its allowed hosts. Other org sandboxes selecting all proxy Secrets, including future sandboxes, can also use a newly saved proxy credential. Updating an existing Secret affects every sandbox already authorized to use it.

Git and editor configuration is copied separately, once, to the named running sandboxes. It is not stored as Secrets, does not consume Secret quota, and is not reapplied on start or resume. This skill moves no repository or agent history. Use `instabox-move-repo` for code and conversation history.

| Group | Destination | Sources |
| --- | --- | --- |
| Tokens | Encrypted org key=value Secrets; explicit per-token `proxy` or `env` mode | GitHub token through `gh auth token`; known service credentials in the environment or shell startup files; other credential-like exports listed unchecked |
| Git | Files under the selected sandbox's home | `.gitconfig`, `.config/git/config`, global gitignore |
| Editor and terminal | Files under the selected sandbox's home | `.vimrc`, nvim config without plugin checkouts, `.tmux.conf` |

The scripts beside this file require Node 18+, `bash` (or `zsh`), `jq` and `HOME` set; sandboxes receiving config files need Python 3. `scan.mjs` reads macOS keychain and Homebrew state, so run this on macOS (or in WSL/Git Bash); the `instabox` CLI itself also runs natively on Windows. Run steps 1–4 in one shell session, or redefine `S`, `W` and `ORG_ID` in each block.

| Script | Responsibility |
| --- | --- |
| `scan.mjs` | Read-only inventory of names, source locations, sizes and manual setup requirements; no credential values in output |
| `plan.mjs` | Write and strictly parse the editable plan, binding it to an org and Secret metadata |
| `push.mjs` | Read approved values into memory, validate all inputs and quotas, save Secrets through CLI stdin, merge explicit sandbox selections, and copy config |
| `content.mjs` | Rewrite HOME paths, remove recognized credential lines, and adapt git/editor configuration for Linux |
| `install-files.py` | Install ordinary config files privately, refusing symlinks and unsafe paths; no Secret-store or legacy Vault access |

Never print credential values, shell startup files, credential-bearing config, or `gh auth token` output. Do not run these scripts against the user's machine unless their request authorizes this setup. Scripts may read credentials internally; their output is limited to names, sizes and outcomes. If a value cannot be obtained, let the user supply it through a hidden CLI prompt with the appropriate org and delivery mode.

## 1. Scan and choose the org

```bash
set -euo pipefail
instabox whoami
instabox org ls --json                              # {"orgs":[...]}: pick an org you own or administer
S=$(for d in ~/.agents/skills/instabox-basic-setup ~/.claude/skills/instabox-basic-setup; do [ -f "$d/SKILL.md" ] && echo "$d/scripts" && break; done)   # or this skill's own directory
W=$(mktemp -d)
node "$S/scan.mjs" > "$W/scan.json"
ORG_ID=org_...                                      # substitute the id from `org ls`
instabox secrets ls --org "$ORG_ID" --json > "$W/secrets.json"
instabox usage --json | jq '.limits.vault // {}' > "$W/limits.json"   # optional; push re-checks the live limits
```

`org ls --json` returns `{"orgs":[...]}`; select one with `jq -r '.orgs[] | "\(.id)\t\(.name)\t\(.role)"'`, and remember that saving Secret values needs the owner or an admin. Check each JSON file before planning (`jq -e . "$W/secrets.json" >/dev/null`): a failed sign-in otherwise leaves an empty file that the parser reports as a JSON error. `usage` reports your personal org; the Secret/Vault quota that applies is still `.limits.vault`.

Saving Secret values requires an org owner/admin sign-in. An API key can read metadata but cannot import values. Do not change the user's authentication silently: if value management is rejected, explain that they need an owner/admin session. A 404 for Secret routes (or `orgSecrets: false` in `instabox usage --json` `.limits`) means Secret management is not configured on that server; fall back to the legacy Vault (`instabox vault ...`).

Use `instabox get <box> --json` to resolve each intended sandbox to its stable `m_...` ID and confirm its `orgId`. No sandbox is required when the user only wants to save credentials. Config copying requires explicitly named running sandboxes; do not create a box merely to verify setup unless creation is authorized.

## 2. Prepare a concrete plan

```bash
node "$S/plan.mjs" write --scan "$W/scan.json" --secrets "$W/secrets.json" \
  --org "$ORG_ID" --sandbox m_... > "$W/plan.md"
```

Repeat `--sandbox` for additional targets, or omit it to save Secrets without adding env grants or copying files. Substitute the real `m_...` id for each sandbox (`instabox get <box> --json`). The plan lists `Org`, `Sandboxes`, checkboxes and one `Delivery` line per token. The org is bound to the metadata used to generate the plan; regenerate for another org. Sandbox IDs and delivery policies can be edited in the plan.

Keep the checkbox lines exactly as written: they must start with `- [` (same indentation and dash), and every env row keeps its `Delivery` line even when unchecked. Re-indenting, switching to `*` or deleting a `Delivery` line makes the strict parser reject the plan.

A token policy looks like either of these:

```text
Delivery `env:SERVICE_API_KEY`: `proxy` hosts `api.example.com`
Delivery `env:DATABASE_URL`: `env` hosts `-`
```

The `env:` prefix is the scanner's variable ID, not its delivery mode. New token rows start with explicit `env` mode for client compatibility; this gives the named sandboxes the real value. Choose `proxy` and exact approved hosts when the client sends the value literally in an HTTPS header on port 443. Do not infer hosts from a token's value or silently switch modes when a client fails. Native database protocols, local signing and git's encoded credential exchange need the real value or a separate protocol-aware broker. Proxy placeholders cannot be used as real signing or encoding inputs.

Well-known token rows are checked by default; unknown and keychain-backed sources are unchecked. Existing Secrets changed outside the last successful run are unchecked, and checking them authorizes replacement in the org. A previous proxy mode is preserved as the starting policy on a repeat run. Files are unchecked when no sandbox is selected. Checking a config file authorizes replacement of that path on each named sandbox.

Show the concrete names, modes, allowed hosts, org and target sandboxes. Obtain any choices or authorization the original request did not already provide before reading values or writing. Do not ask again for an action already explicitly authorized. Explain that env values are readable by sandbox code and may persist in processes, files or snapshots; removing a selection cannot recover them.

Parse the approved plan:

```bash
node "$S/plan.mjs" parse --scan "$W/scan.json" --secrets "$W/secrets.json" \
  --org "$ORG_ID" --limits "$W/limits.json" "$W/plan.md" > "$W/selection.json"
```

Exit codes: `0` success; `1` malformed or missing rows, invalid policies, a changed org/catalog, unsafe config, a file selection without targets, or a single config file over 64 KiB; `2` bad command-line usage (`push.mjs` and `scan.mjs`; `plan.mjs` reports usage errors as 1); `3` the aggregate copy/transfer limit or a Secret quota. Fix choices without changing item IDs or deleting rows. Config files have their own copy limits and do not count as Secret entries. Values are measured before push; plan generation never reads token values. Legacy selector-based plans and manifests grant no authority in the new model and must be regenerated.

## 3. Dry-run, then apply the approved selection

```bash
node "$S/push.mjs" --selection "$W/selection.json" --dry-run
node "$S/push.mjs" --selection "$W/selection.json"
```

The dry-run reads the approved credential sources and prepares filtered config, but makes no writes to InstaBox and does not change its local manifest. Sourcing a shell startup file may run its local initialization code; an approved keychain-backed source may invoke its lookup. Values remain in memory and CLI stdin, never in the plan, manifest, arguments or logs. Review the dry-run's metadata before applying any action not yet authorized.

The pusher verifies org ownership, target orgs, Secret IDs and versions, input limits and total Secret quota before mutations. If a selected Secret changed since planning, regenerate the plan. These are preflight checks, not a transaction across all CLI operations: concurrent org edits can still occur during application. A failed run reports partial outcomes; successfully saved Secrets remain in the org. Do not assume rollback or automatic removal of previously copied files.

Only selected token names are added to each target's grants; existing selections are preserved, including proxy `all`. Env selection never becomes `all`. Running targets receive an immediate managed-environment refresh; stopped targets can receive selections for their next start, but config copying requires them to be running. A failed or pending guest refresh does not install config that may depend on those credentials. Existing processes need to reload their environment or restart.

Files are transformed before direct copying: this machine's HOME becomes `/data/home`, recognized credential lines are removed, macOS-only lines and unsupported signing/SSH rewrites are commented out. Structured config suspected of containing credentials is rejected rather than copied verbatim. This filtering is best effort, not a guarantee that arbitrary configuration is credential-free. The gh git helper is added only when this plan explicitly selects `GH_TOKEN` with env delivery. An existing org Secret by itself is not a sandbox grant; reuse it through an explicitly reviewed `instabox secrets select` update if needed, preserving other selected names.

The local manifest at `~/.config/instabox-basic-setup/pushed.json` stores org IDs, Secret IDs/versions/modes and copied sandbox paths, never values. It does not grant reuse across orgs or across deletion and recreation of a Secret. It records completed work for a repeat plan; it does not sync changes automatically.

## 4. Verify and report

```bash
BOX=m_...                       # one of the target sandboxes, by id or name
instabox secrets show "$BOX"
instabox exec "$BOX" -- 'test "${GH_TOKEN+x}" = x && test -f "$HOME/.gitconfig"'
```

Use silent presence checks and metadata; never print variables to verify them. A placeholder's presence does not prove proxy authorization or upstream success. Confirm client behavior without logging credentials, and explain application restarts when env values changed.

Report the org Secret names and modes saved, sandbox IDs whose selections changed, config paths copied, failures and manual setup steps. Saving env Secrets without targets adds no grants; replacing a value still affects sandboxes already authorized to use it. Future boxes without Secret selection flags keep their existing Vault behavior. At creation, selecting env Secrets alone also selects all org proxy Secrets; add an explicit proxy selection to narrow that access. Previously saved credentials or config not selected this time remain; deletion or cleanup needs its own intended scope. Rotate or revoke upstream when a previously delivered env value must stop working.

Config edits in a sandbox are not overwritten at every resume. Shell aliases, SSH keys, cloud credential files, agent sign-in databases and repositories are outside this inventory. Complete the selected manual sign-in steps only within existing authorization. Remove `$W` when no longer needed; it contains metadata and choices, not credential values.
