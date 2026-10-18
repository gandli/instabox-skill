#!/usr/bin/env node
/**
 * ibx — a dependency-free client for the documented InstaBox HTTP API.
 *
 * Use it when the official `instabox` CLI is not installed and you only need a
 * call or two. Node 18+ (global fetch). No npm dependencies.
 *
 *   export INSTABOX_API_KEY=ibk_...
 *   node scripts/ibx.mjs ls
 *   node scripts/ibx.mjs create dev --template universal --timeout 30m
 *   node scripts/ibx.mjs exec dev -- uname -a
 *
 * Flags: --json (raw JSON), --api-key, --api-url, --help.
 * A .env in the current directory (or next to this script) is loaded, but real
 * environment variables win. Never commit that .env.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function loadDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(SCRIPT_DIR, '..', '.env'),
    path.resolve(SCRIPT_DIR, '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      if (process.env[key] !== undefined) continue
      let value = m[2]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
    return file
  }
  return null
}

const HELP = `ibx — InstaBox HTTP API client (Node 18+)

  ibx me | usage | templates
  ibx ls [--meta K=V]... [--limit N]
  ibx get <machine>
  ibx create <name> [--template T | --snapshot S] [--timeout 30m] [--on-timeout pause|kill]
             [--auto-suspend 10m] [--meta K=V]... [--guest-user U] [--no-vault] [--no-wait]
  ibx start|stop|suspend|resume|rm <machine> [--no-wait]
  ibx timeout <machine> <duration> [--on-timeout pause|kill]
  ibx auto-suspend <machine> <duration>
  ibx exec <machine> [--cwd DIR] [--env K=V]... [--timeout SEC] [--stdin] -- <command>
  ibx files <machine> [path]
  ibx info <machine>                       SSH host, port, user, host CA
  ibx wake <machine>
  ibx metrics <machine> [--since 15m|ISO]
  ibx machine-usage <machine> [--from ISO] [--to ISO]
  ibx snapshot save <machine> --name N [--description D] [--root-only] [--no-wait]
  ibx snapshot ls | get <id> | files <id> [path] | rm <id>
  ibx port ls [machine] | publish <machine> <port> [--name N] | rm <machine> <port>
  ibx ssh-token <machine> [--ttl 7d] [--mosh] [--json]
  ibx ssh-tokens <machine> | ssh-revoke <machine> [tokenID]
  ibx desktop status|start <machine> [--width W] [--height H]
  ibx desktop stream <machine> [--ttl SEC] [--control] | revoke <machine>
  ibx wait <operationId>

  <machine> is an id (m_...) or a name. Durations: 90s, 30m, 1h, 7d.
  Env: INSTABOX_API_KEY (required), INSTABOX_API_URL (default https://api.instabox.sh).
`

function fail(message, status) {
  process.stderr.write(`ibx: ${message}\n`)
  process.exit(status && status > 0 ? 1 : 1)
}

function parseDuration(text, { allowZero = true } = {}) {
  if (text === undefined || text === null) return undefined
  const s = String(text).trim()
  if (s === '0') {
    if (!allowZero) fail('0 is not allowed here')
    return 0
  }
  const m = s.match(/^(\d+)\s*(s|m|h|d)?$/i)
  if (!m) fail(`bad duration "${s}" (use 90s, 30m, 1h, 7d)`)
  const n = Number(m[1])
  const unit = (m[2] || 's').toLowerCase()
  return unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400
}

function isoFromDuration(text) {
  const seconds = parseDuration(text)
  return new Date(Date.now() - seconds * 1000).toISOString()
}

function parseArgs(argv) {
  const flags = []
  const positionals = []
  let rest = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      rest = argv.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      const body = a.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        flags.push({ name: body.slice(0, eq), value: body.slice(eq + 1) })
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags.push({ name: body, value: next })
          i++
        } else {
          flags.push({ name: body, value: true })
        }
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals, rest }
}

const flagMap = (flags) => {
  const map = new Map()
  for (const f of flags) {
    if (!map.has(f.name)) map.set(f.name, [])
    map.get(f.name).push(f.value)
  }
  return map
}
const has = (map, name) => map.has(name)
const one = (map, name) => (map.has(name) ? map.get(name)[map.get(name).length - 1] : undefined)
const many = (map, name) => (map.has(name) ? map.get(name) : [])

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length)))
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()
  const out = [line(columns.map((c) => c.label))]
  for (const r of rows) out.push(line(columns.map((c) => r[c.key] ?? '')))
  return out.join('\n')
}

function humanBytes(n) {
  if (!Number.isFinite(n)) return String(n)
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function main() {
  loadDotEnv()
  const { flags, positionals, rest } = parseArgs(process.argv.slice(2))
  const opts = flagMap(flags)

  if (positionals.length === 0 || has(opts, 'help') || positionals[0] === 'help') {
    process.stdout.write(HELP)
    return
  }

  const apiKey = one(opts, 'api-key') || process.env.INSTABOX_API_KEY
  const apiUrl = (one(opts, 'api-url') || process.env.INSTABOX_API_URL || 'https://api.instabox.sh').replace(/\/+$/, '')
  const asJson = has(opts, 'json')
  if (!apiKey) fail('no API key: set INSTABOX_API_KEY or pass --api-key')

  const headers = { 'X-API-Key': apiKey }

  const idCache = new Map()

  // The network is occasionally flaky behind a proxy: one quick retry, but only
  // for reads and calls carrying an Idempotency-Key (never `exec`).
  async function send(method, url, init) {
    const retryable = method === 'GET' || Boolean(init.headers && init.headers['Idempotency-Key'])
    let lastError
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetch(url, init)
      } catch (err) {
        lastError = err
        if (!retryable || attempt === 1) break
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    throw lastError
  }

  async function parse(res) {
    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }
    }
    if (!res.ok) {
      const err = (data && data.error) || {}
      const code = err.code || res.status
      const msg = err.message || res.statusText || 'request failed'
      process.stderr.write(`ibx: HTTP ${res.status} ${code}: ${msg}${err.retryable ? ' (retryable)' : ''}\n`)
      process.exit(1)
    }
    return data
  }

  async function request(method, route, { body, idempotent = false, query } = {}) {
    // Nested /v1/machines/{id}/... routes need the real ID; resolve a name once.
    const nested = route.match(/^\/v1\/machines\/([^/?#]+)(\/.+)$/)
    if (nested) {
      const seg = decodeURIComponent(nested[1])
      if (!seg.startsWith('m_')) {
        if (!idCache.has(seg)) {
          const lookup = await send('GET', `${apiUrl}/v1/machines/${encodeURIComponent(seg)}`, {
            method: 'GET',
            headers: { ...headers },
          })
          const data = await parse(lookup)
          idCache.set(seg, data.id)
          idCache.set(data.id, data.id)
        }
        route = `/v1/machines/${encodeURIComponent(idCache.get(seg))}${nested[2]}`
      }
    }
    let url = apiUrl + route
    if (query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue
        for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item))
      }
      const s = qs.toString()
      if (s) url += '?' + s
    }
    const init = { method, headers: { ...headers } }
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    if (idempotent) init.headers['Idempotency-Key'] = crypto.randomUUID()
    const res = await send(method, url, init)
    const data = await parse(res)
    return { status: res.status, data }
  }

  async function waitOperation(id) {
    for (;;) {
      const { data } = await request('GET', `/v1/operations/${encodeURIComponent(id)}`, { query: { wait: '25s' } })
      if (data.state === 'succeeded') return data
      if (data.state === 'failed') {
        const e = data.error || {}
        fail(`operation ${id} failed: ${e.code || 'unknown'}${e.message ? `: ${e.message}` : ''}`)
      }
      if (!asJson) process.stderr.write(`\r  ${id} ${data.state}${data.phase ? ` (${data.phase})` : ''}          `)
    }
  }

  function printJson(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  }

  function machineOf(data) {
    return data.machine || data
  }

  async function resolveMachine(ref) {
    if (!ref) fail('missing machine (id or name)')
    const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}`)
    return data
  }

  async function lifecycle(ref, action) {
    const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/${action}`, {
      idempotent: true,
      body: {},
    })
    const op = data
    if (has(opts, 'no-wait')) {
      if (asJson) return printJson(op)
      process.stdout.write(`${op.type} queued: ${op.id} (machine ${op.machineId})\n`)
      return
    }
    const done = await waitOperation(op.id)
    if (asJson) return printJson(done)
    const m = done.machine
    process.stdout.write(`${op.type}: ${m ? `${m.name} ${m.state}` : done.state}\n`)
  }

  const [command, ...args] = positionals

  return (async () => {
    switch (command) {
      case 'me': {
        const { data } = await request('GET', '/v1/me')
        return printJson(data)
      }
      case 'usage': {
        const { data } = await request('GET', '/v1/usage')
        if (asJson) return printJson(data)
        const l = data.limits || {}
        process.stdout.write(
          [
            `machines   ${data.machines}${l.maxMachines ? ` / ${l.maxMachines}` : ''}`,
            `snapshots  ${data.snapshots}${l.maxSnapshots ? ` / ${l.maxSnapshots}` : ''}`,
            `stored     ${humanBytes(data.storedBytes)}${l.maxStoredGiB ? ` / ${l.maxStoredGiB} GiB` : ''}`,
            `computedAt ${data.computedAt || '(not measured yet)'}`,
          ].join('\n') + '\n',
        )
        const machines = (data.storage && data.storage.machines) || []
        if (machines.length) {
          process.stdout.write(
            table(
              machines.map((m) => ({ id: m.id, name: m.name, state: m.state, disk: humanBytes(m.diskBytes), snaps: m.snapshots })),
              [
                { key: 'id', label: 'ID' },
                { key: 'name', label: 'NAME' },
                { key: 'state', label: 'STATE' },
                { key: 'disk', label: 'DISK' },
                { key: 'snaps', label: 'SNAPSHOTS' },
              ],
            ) + '\n',
          )
        }
        return
      }
      case 'templates': {
        const { data } = await request('GET', '/v1/templates')
        if (asJson) return printJson(data)
        const seen = new Map()
        for (const t of data.templates || []) {
          const prev = seen.get(t.id)
          if (!prev || String(t.version) > String(prev.version)) seen.set(t.id, t)
        }
        process.stdout.write(
          table(
            [...seen.values()].map((t) => ({
              id: t.id,
              version: t.version,
              hidden: t.hidden ? 'hidden' : '',
              caps: (t.capabilities || []).join(','),
            })),
            [
              { key: 'id', label: 'TEMPLATE' },
              { key: 'version', label: 'VERSION' },
              { key: 'hidden', label: '' },
              { key: 'caps', label: 'CAPABILITIES' },
            ],
          ) + '\n',
        )
        return
      }
      case 'ls': {
        const metadata = many(opts, 'meta')
        const { data } = await request('GET', '/v1/machines', {
          query: { metadata: metadata.length ? metadata : undefined, limit: one(opts, 'limit') },
        })
        if (asJson) return printJson(data)
        const rows = (data.machines || []).map((m) => ({
          id: m.id,
          name: m.name,
          state: m.state,
          template: m.template && m.template.id,
          timeout: m.timeoutAt || '',
          created: m.createdAt,
        }))
        if (!rows.length) return process.stdout.write('no machines\n')
        process.stdout.write(
          table(rows, [
            { key: 'name', label: 'NAME' },
            { key: 'state', label: 'STATE' },
            { key: 'template', label: 'TEMPLATE' },
            { key: 'timeout', label: 'TIMEOUT AT' },
            { key: 'id', label: 'ID' },
          ]) + '\n',
        )
        return
      }
      case 'get': {
        const m = await resolveMachine(args[0])
        return printJson(m)
      }
      case 'create': {
        const name = args[0]
        if (!name) fail('usage: ibx create <name> [--template T | --snapshot S]')
        const templateId = one(opts, 'template')
        const snapshotId = one(opts, 'snapshot')
        if (!templateId && !snapshotId) fail('give --template or --snapshot')
        const body = { name }
        if (templateId) body.templateId = templateId
        if (snapshotId) body.snapshotId = snapshotId
        const timeout = one(opts, 'timeout')
        if (timeout !== undefined) body.timeoutSeconds = parseDuration(timeout)
        const onTimeout = one(opts, 'on-timeout')
        if (onTimeout) body.onTimeout = onTimeout
        const autoSuspend = one(opts, 'auto-suspend')
        if (autoSuspend !== undefined) body.autoSuspendAfterSeconds = parseDuration(autoSuspend)
        const guestUser = one(opts, 'guest-user')
        if (guestUser) body.guestUser = guestUser
        if (has(opts, 'no-vault')) body.vault = false
        const metadata = {}
        for (const kv of many(opts, 'meta')) {
          const i = kv.indexOf('=')
          if (i < 1) fail(`bad --meta "${kv}" (use key=value)`)
          metadata[kv.slice(0, i)] = kv.slice(i + 1)
        }
        if (Object.keys(metadata).length) body.metadata = metadata
        const { data } = await request('POST', '/v1/machines', { body, idempotent: true })
        if (has(opts, 'no-wait')) {
          if (asJson) return printJson(data)
          return process.stdout.write(`${data.id} ${data.machineId} ${data.state}\n`)
        }
        const done = await waitOperation(data.id)
        const m = done.machine || (await resolveMachine(data.machineId))
        if (asJson) return printJson(m)
        process.stdout.write(`created ${m.name} ${m.id} ${m.state}\n`)
        return
      }
      case 'start':
      case 'stop':
      case 'suspend':
      case 'resume':
      case 'rm': {
        const action = command === 'rm' ? null : command
        const ref = args[0]
        if (!ref) fail(`usage: ibx ${command} <machine>`)
        if (action === null) {
          const { data } = await request('DELETE', `/v1/machines/${encodeURIComponent(ref)}`, { idempotent: true })
          if (has(opts, 'no-wait') || !data || !data.id) {
            if (asJson) return printJson(data)
            return process.stdout.write(`delete requested for ${ref}\n`)
          }
          const done = await waitOperation(data.id)
          if (asJson) return printJson(done)
          return process.stdout.write(`deleted ${ref}\n`)
        }
        return lifecycle(ref, action)
      }
      case 'timeout': {
        const ref = args[0]
        const dur = args[1]
        if (!ref || dur === undefined) fail('usage: ibx timeout <machine> <duration>')
        const body = { timeoutSeconds: parseDuration(dur) }
        const onTimeout = one(opts, 'on-timeout')
        if (onTimeout) body.onTimeout = onTimeout
        const { data } = await request('PATCH', `/v1/machines/${encodeURIComponent(ref)}`, { body, idempotent: true })
        if (asJson) return printJson(data)
        return process.stdout.write(`timeout ${data.name}: ${data.timeoutAt || 'cleared'} (${data.onTimeout})\n`)
      }
      case 'auto-suspend': {
        const ref = args[0]
        const dur = args[1]
        if (!ref || dur === undefined) fail('usage: ibx auto-suspend <machine> <duration|0>')
        const { data } = await request('PATCH', `/v1/machines/${encodeURIComponent(ref)}`, {
          body: { autoSuspendAfterSeconds: parseDuration(dur) },
          idempotent: true,
        })
        if (asJson) return printJson(data)
        return process.stdout.write(`auto-suspend ${data.name}: ${data.autoSuspendAfterSeconds ?? 'off'}\n`)
      }
      case 'exec': {
        const ref = args[0]
        const cmd = rest && rest.length ? rest.join(' ') : args.slice(1).join(' ')
        if (!ref || !cmd) fail('usage: ibx exec <machine> [flags] -- <command>')
        const body = { cmd }
        const cwd = one(opts, 'cwd')
        if (cwd) body.cwd = cwd
        const envs = {}
        for (const kv of many(opts, 'env')) {
          const i = kv.indexOf('=')
          if (i < 1) fail(`bad --env "${kv}" (use key=value)`)
          envs[kv.slice(0, i)] = kv.slice(i + 1)
        }
        if (Object.keys(envs).length) body.envs = envs
        const timeout = one(opts, 'timeout')
        if (timeout !== undefined) body.timeoutSeconds = parseDuration(timeout)
        if (has(opts, 'stdin')) {
          const chunks = []
          for await (const chunk of process.stdin) chunks.push(chunk)
          body.stdin = Buffer.concat(chunks).toString('utf8')
        }
        const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/exec`, { body })
        if (asJson) {
          printJson(data)
        } else {
          if (data.stdout) process.stdout.write(data.stdout)
          if (data.stderr) process.stderr.write(data.stderr)
          if (data.truncated) process.stderr.write('\n[ibx] output truncated at 1 MiB\n')
          if (data.timedOut) process.stderr.write('\n[ibx] command timed out\n')
        }
        process.exit(data.exitCode === 0 ? 0 : data.exitCode || 1)
        return
      }
      case 'files': {
        const ref = args[0]
        if (!ref) fail('usage: ibx files <machine> [path]')
        const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}/files`, {
          query: { path: args[1] || '/' },
        })
        if (asJson) return printJson(data)
        if (data.type === 'dir') {
          const rows = (data.entries || []).map((e) => ({
            type: e.type === 'dir' ? 'd' : e.type === 'symlink' ? 'l' : '-',
            size: e.size,
            mode: e.mode,
            name: e.name,
          }))
          return process.stdout.write(
            table(rows, [
              { key: 'type', label: 'T' },
              { key: 'mode', label: 'MODE' },
              { key: 'size', label: 'SIZE' },
              { key: 'name', label: 'NAME' },
            ]) + '\n',
          )
        }
        if (data.type === 'symlink') return process.stdout.write(`${data.path} -> ${data.target || ''}\n`)
        return process.stdout.write(data.content !== undefined ? data.content : JSON.stringify(data) + '\n')
      }
      case 'info': {
        const ref = args[0]
        if (!ref) fail('usage: ibx info <machine>')
        const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}/connection-info`)
        if (asJson) return printJson(data)
        return process.stdout.write(
          `ssh -p ${data.port} ${data.username}@${data.host}\n` +
            `host CA: ${data.hostTrust ? data.hostTrust.publicKey : '(unknown)'}\n` +
            `capabilities: ${(data.capabilities || []).join(', ')}\n`,
        )
      }
      case 'wake': {
        const ref = args[0]
        if (!ref) fail('usage: ibx wake <machine>')
        const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/wake`)
        if (asJson) return printJson(data)
        return process.stdout.write(`wake: ${data.state || JSON.stringify(data)}\n`)
      }
      case 'metrics': {
        const ref = args[0]
        if (!ref) fail('usage: ibx metrics <machine> [--since 15m|ISO]')
        const since = one(opts, 'since')
        const query = { since: since ? (since.includes('T') ? since : isoFromDuration(since)) : undefined }
        const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}/metrics`, { query })
        if (asJson) return printJson(data)
        const rows = (data.metrics || []).map((m) => ({
          at: m.timestamp,
          cpu: `${Number(m.cpuUsedPct).toFixed(1)}%`,
          mem: `${humanBytes(m.memUsed)} / ${humanBytes(m.memTotal)}`,
        }))
        if (!rows.length) return process.stdout.write('no samples (machine not running in the window)\n')
        return process.stdout.write(
          table(rows, [
            { key: 'at', label: 'TIME' },
            { key: 'cpu', label: 'CPU' },
            { key: 'mem', label: 'MEMORY' },
          ]) + '\n',
        )
      }
      case 'machine-usage': {
        const ref = args[0]
        if (!ref) fail('usage: ibx machine-usage <machine> [--from ISO] [--to ISO]')
        const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}/usage`, {
          query: { from: one(opts, 'from'), to: one(opts, 'to') },
        })
        if (asJson) return printJson(data)
        return process.stdout.write(
          [
            `window   ${data.from} .. ${data.to}`,
            `running  ${data.runningSeconds}s`,
            `vcpu     ${data.vcpuSeconds}s`,
            `memory   ${Number(data.memGiBSeconds).toFixed(2)} GiB·s`,
            `disk     ${data.diskGiBSeconds} GiB·s`,
          ].join('\n') + '\n',
        )
      }
      case 'snapshot': {
        const sub = args[0]
        if (sub === 'ls') {
          const { data } = await request('GET', '/v1/snapshots')
          if (asJson) return printJson(data)
          const rows = (data.snapshots || []).map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            data: humanBytes(s.dataSizeBytes || 0),
            created: s.createdAt,
          }))
          if (!rows.length) return process.stdout.write('no snapshots\n')
          return process.stdout.write(
            table(rows, [
              { key: 'name', label: 'NAME' },
              { key: 'status', label: 'STATUS' },
              { key: 'data', label: '/DATA' },
              { key: 'created', label: 'CREATED' },
              { key: 'id', label: 'ID' },
            ]) + '\n',
          )
        }
        if (sub === 'save') {
          const ref = args[1]
          const name = one(opts, 'name')
          if (!ref || !name) fail('usage: ibx snapshot save <machine> --name N')
          const body = { name }
          const description = one(opts, 'description')
          if (description) body.description = description
          if (has(opts, 'root-only')) body.rootOnly = true
          const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/snapshots`, {
            body,
            idempotent: true,
          })
          if (has(opts, 'no-wait') || data.status !== 'pending') {
            if (asJson) return printJson(data)
            return process.stdout.write(`snapshot ${data.name} ${data.id} ${data.status}\n`)
          }
          let snap = data
          while (snap.status === 'pending') {
            await new Promise((r) => setTimeout(r, 3000))
            const res = await request('GET', `/v1/snapshots/${encodeURIComponent(snap.id)}`)
            snap = res.data
          }
          if (asJson) return printJson(snap)
          if (snap.status === 'failed') fail(`snapshot failed: ${snap.error || 'unknown'}`)
          return process.stdout.write(`snapshot ${snap.name} ${snap.id} ${snap.status}\n`)
        }
        if (sub === 'get') {
          const { data } = await request('GET', `/v1/snapshots/${encodeURIComponent(args[1] || '')}`)
          return printJson(data)
        }
        if (sub === 'files') {
          const id = args[1]
          const p = args[2] || '/'
          if (!id) fail('usage: ibx snapshot files <id> [path]')
          const { data } = await request('GET', `/v1/snapshots/${encodeURIComponent(id)}/files`, { query: { path: p } })
          if (asJson) return printJson(data)
          if (data.type === 'dir') {
            return process.stdout.write(
              (data.entries || []).map((e) => `${e.type === 'dir' ? 'd' : '-'} ${e.mode} ${e.size} ${e.name}`).join('\n') + '\n',
            )
          }
          return process.stdout.write((data.content || '') + '\n')
        }
        if (sub === 'rm') {
          const id = args[1]
          if (!id) fail('usage: ibx snapshot rm <id>')
          await request('DELETE', `/v1/snapshots/${encodeURIComponent(id)}`, { idempotent: true })
          return process.stdout.write(`deleted snapshot ${id}\n`)
        }
        return fail('usage: ibx snapshot save|ls|get|files|rm ...')
      }
      case 'port': {
        const sub = args[0]
        if (sub === 'ls') {
          const ref = args[1]
          const { data } = await request('GET', ref ? `/v1/machines/${encodeURIComponent(ref)}/ports` : '/v1/ports')
          if (asJson) return printJson(data)
          const rows = (data.ports || []).map((p) => ({ port: p.port, name: p.name, url: p.url, machine: p.machineId }))
          if (!rows.length) return process.stdout.write('no public ports\n')
          return process.stdout.write(
            table(rows, [
              { key: 'port', label: 'PORT' },
              { key: 'name', label: 'NAME' },
              { key: 'url', label: 'URL' },
              { key: 'machine', label: 'MACHINE' },
            ]) + '\n',
          )
        }
        if (sub === 'publish') {
          const ref = args[1]
          const port = Number(args[2])
          if (!ref || !Number.isInteger(port)) fail('usage: ibx port publish <machine> <port> [--name N]')
          const body = { port }
          const name = one(opts, 'name')
          if (name) body.name = name
          const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/ports`, { body })
          if (asJson) return printJson(data)
          return process.stdout.write(`${data.url}\n`)
        }
        if (sub === 'rm' || sub === 'unpublish') {
          const ref = args[1]
          const port = Number(args[2])
          if (!ref || !Number.isInteger(port)) fail('usage: ibx port rm <machine> <port>')
          await request('DELETE', `/v1/machines/${encodeURIComponent(ref)}/ports/${port}`)
          return process.stdout.write(`unpublished ${port} on ${ref}\n`)
        }
        return fail('usage: ibx port ls|publish|rm ...')
      }
      case 'ssh-token': {
        const ref = args[0]
        if (!ref) fail('usage: ibx ssh-token <machine> [--ttl 7d] [--mosh]')
        const body = {}
        const ttl = one(opts, 'ttl')
        if (ttl !== undefined) body.ttlSeconds = parseDuration(ttl)
        const name = one(opts, 'name')
        if (name) body.name = name
        const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/ssh-tokens`, { body })
        if (asJson) return printJson(data)
        const cmd = has(opts, 'mosh') ? data.command.replace(/^ssh /, 'mosh --ssh="ssh -p ' + data.port + '" ') : data.command
        return process.stdout.write(`${cmd}\nexpires ${data.expiresAt}\n`)
      }
      case 'ssh-tokens': {
        const ref = args[0]
        if (!ref) fail('usage: ibx ssh-tokens <machine>')
        const { data } = await request('GET', `/v1/machines/${encodeURIComponent(ref)}/ssh-tokens`)
        if (asJson) return printJson(data)
        const rows = (data.tokens || []).map((t) => ({ id: t.id, name: t.name, created: t.createdAt, expires: t.expiresAt }))
        if (!rows.length) return process.stdout.write('no tokens\n')
        return process.stdout.write(
          table(rows, [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'NAME' },
            { key: 'expires', label: 'EXPIRES' },
          ]) + '\n',
        )
      }
      case 'ssh-revoke': {
        const ref = args[0]
        if (!ref) fail('usage: ibx ssh-revoke <machine> [tokenID]')
        const token = args[1]
        const route = `/v1/machines/${encodeURIComponent(ref)}/ssh-tokens${token ? '/' + encodeURIComponent(token) : ''}`
        const { data } = await request('DELETE', route)
        if (asJson) return printJson(data)
        return process.stdout.write(token ? `revoked ${token}\n` : `revoked ${data && data.revoked} tokens\n`)
      }
      case 'desktop': {
        const sub = args[0]
        const ref = args[1] || args[0]
        if (sub === 'stream') {
          if (!ref) fail('usage: ibx desktop stream <machine> [--ttl SEC] [--control]')
          const body = { viewOnly: !has(opts, 'control') }
          const ttl = one(opts, 'ttl')
          if (ttl !== undefined) body.ttlSeconds = parseDuration(ttl)
          const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/desktop/stream`, { body })
          if (asJson) return printJson(data)
          return process.stdout.write(`${data.url}\nexpires ${data.expiresAt}\n`)
        }
        if (sub === 'revoke') {
          if (!ref) fail('usage: ibx desktop revoke <machine>')
          await request('DELETE', `/v1/machines/${encodeURIComponent(ref)}/desktop/stream`)
          return process.stdout.write(`revoked desktop links for ${ref}\n`)
        }
        if (['status', 'start', 'install', 'takeover', 'handback'].includes(sub)) {
          if (!ref) fail('usage: ibx desktop status|start <machine>')
          const body = { action: sub }
          const width = one(opts, 'width')
          const height = one(opts, 'height')
          if (width) body.width = Number(width)
          if (height) body.height = Number(height)
          const { data } = await request('POST', `/v1/machines/${encodeURIComponent(ref)}/desktop`, { body })
          if (asJson) return printJson(data)
          return process.stdout.write(
            `installed=${data.installed} running=${data.running} installing=${data.installing} controller=${data.controller || '-'}\n`,
          )
        }
        return fail('usage: ibx desktop status|start|stream|revoke <machine>')
      }
      case 'wait': {
        const id = args[0]
        if (!id) fail('usage: ibx wait <operationId>')
        const done = await waitOperation(id)
        if (asJson) return printJson(done)
        return process.stdout.write(`${done.type} ${done.state}\n`)
      }
      default:
        return fail(`unknown command "${command}" (try: ibx --help)`)
    }
  })().catch((err) => {
    fail(err && err.message ? err.message : String(err))
  })
}

main()
