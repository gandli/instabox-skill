# instabox CLI

Install once:

```bash
curl -fsSL https://api.instabox.sh/install.sh | sh     # installs `instabox`
npx instabox@latest sh                                 # or: sign in, create a machine, open a shell
```

`instabox --help` and `instabox <command> --help` are authoritative for the installed version. `--json` on any read command prints raw JSON.

## Auth

```bash
instabox login                    # browser sign-in
instabox login --device           # no browser: prints a code to enter elsewhere
instabox login --provider github  # or google
instabox logout                   # revoke and forget stored credentials
instabox whoami                   # the signed-in user
```

Programs, CI jobs and agents use a key instead of a sign-in:

```bash
export INSTABOX_API_KEY=ibk_...
export INSTABOX_API_URL=https://api.instabox.sh   # optional
```

With `INSTABOX_API_KEY` set, every command uses the key and no login is needed.

## Machines

```bash
instabox templates [--json]                  # what a machine can start from
instabox ls [--meta K=V ...] [--json]        # machines; repeated --meta is AND
instabox create --name N [--template T | --snapshot S] \
    [--timeout 30m [--on-timeout pause|kill]] \
    [--auto-suspend 10m|0] [--meta K=V ...] [--no-wait]
instabox get MACHINE [--json]
instabox timeout MACHINE DURATION [--on-timeout pause|kill]   # 0 clears
instabox auto-suspend MACHINE DURATION|0
instabox start MACHINE [--no-wait]
instabox stop MACHINE [--no-wait]
instabox suspend MACHINE [--no-wait]         # suspend = pause; memory kept
instabox resume MACHINE [--no-wait]
instabox rm MACHINE [--no-wait]              # deletes it and its disks
instabox usage [--json]                      # counts, stored bytes, limits
instabox exec MACHINE [--cwd DIR] [--env K=V ...] [--timeout SECONDS] [--stdin] -- CMD...
instabox files MACHINE [PATH] [--json]       # list a directory, or print a text file
```

Notes:

- `MACHINE` is an ID (`m_...`) or a name. `create` waits until the machine runs unless `--no-wait`.
- `exec` exits with the command's exit code; `--stdin` feeds stdin (≤1 MiB). Default timeout 60 s, max 600 s. Output is returned at the end, not streamed.
- `files` reads as root: directories list up to 5000 entries, text files up to 256 KiB.
- Default template is `agent-browser`; `universal` has Docker, Python (uv), Go and Rust. Templates: `agent-browser`, `universal`, `herdr`, `orca`.
- Machine size is fixed at 4 vCPU / 8 GiB / 20 GiB; there are no size flags.

## Snapshots

```bash
instabox snapshot save MACHINE --name N [--description D] [--root-only] [--no-wait]
instabox snapshot ls [--json]
instabox snapshot files SNAPSHOT [PATH] [--json]   # read saved files, no machine
instabox snapshot rm SNAPSHOT
```

`snapshot save` waits until the snapshot is saved; `--no-wait` returns at once. `--root-only` saves installed software only, so machines from it start with an empty home and workspace.

## SSH and mosh

```bash
instabox ssh MACHINE [-- SSH_ARGS_OR_COMMAND]   # certificate + known_hosts + ssh
instabox mosh MACHINE [-- COMMAND]              # needs mosh on your computer
instabox ssh-config MACHINE                     # print a ~/.ssh/config Host block
instabox ssh-cert MACHINE                       # refresh the certificate only
instabox ssh-token MACHINE [--ttl 7d] [--mosh] [--json]
instabox ssh-token MACHINE --revoke            # revoke all SSH commands of the machine
```

An SSH token is a plain `ssh -p 2222 ibssh_...@api.instabox.sh` command for any terminal — no CLI and no key on the client. The token is printed once. A certificate (used by `instabox ssh`) signs your own public key for a short time.

## Public ports

```bash
instabox port publish MACHINE PORT [--name NAME] [--json]   # prints the URL
instabox port ls [MACHINE]                                  # one machine or all
instabox port unpublish MACHINE PORT
instabox port setup MACHINE                                 # install instabox-port inside
instabox wake MACHINE                                       # resume an idle-paused machine
```

Inside the machine, `instabox-port publish 3000`, `instabox-port serve ./dir --port 8080`, `instabox-port ls`, `instabox-port unpublish 3000` do the same from a shell.

## Orca

```bash
instabox orca connect [--scope runtime|mobile]   # one-time Orca connection, JSON
```

For machines from the `orca` template.

## Vault

```bash
instabox vault set NAME [--selector K=V ...]           # env item; stdin or hidden prompt
instabox vault set-file PATH --from FILE [--selector K=V ...]
instabox vault import FILE                             # KEY=value per line
instabox vault ls [--json]                             # names, never values
instabox vault rm NAME
instabox vault show MACHINE                            # what that machine gets, last write
instabox vault push MACHINE                            # write the items in now
instabox create --name N --no-vault                    # machine that never gets them
```

## API keys

```bash
instabox keys create --name N [--scope S ...] [--expires-in-days N]   # secret printed once
instabox keys ls [--json]
instabox keys rm KEY_ID
```

Scopes: `machines:read`, `machines:write`, `machines:delete`, `images:read`, `images:write`, `images:delete`. `:write` and `:delete` include `:read`. Give `images:read` to keys that create machines from snapshot names. Keys cannot create keys over the API.

## Global flags

```bash
--server URL              # API server (env INSTABOX_SERVER or INSTABOX_API_URL)
--ca-cert FILE            # extra CA certificate (env INSTABOX_CA_CERT)
--insecure-skip-verify    # development only
```

## Recipes

```bash
# a disposable review box that kills itself after 30 minutes
instabox create --name review --template universal --timeout 30m --on-timeout kill
instabox exec review -- 'git clone https://github.com/acme/app && cd app && npm ci'
instabox port publish review 3000 --name preview
instabox ssh review

# set up once, reuse
instabox create --name base --template universal
instabox exec base -- 'sudo apt-get update && sudo apt-get install -y ffmpeg'
instabox snapshot save base --name media-base
instabox create --name job1 --snapshot media-base
instabox rm base

# find everything one team owns
instabox ls --meta team=infra --json | jq -r '.machines[].name'
```
