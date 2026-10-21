#!/usr/bin/env node
// Validate the skill suite: frontmatter, names, code fences and stray SKILL.md files.
// No dependencies; run with `node tools/validate-skills.mjs` on Node 18+.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILLS = join(ROOT, 'skills');
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__']);
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];
const skills = [];

function fail(message) {
  errors.push(message);
}

function parseFrontmatter(text, file) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    fail(`${file}: must start with a YAML frontmatter block`);
    return null;
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) {
    fail(`${file}: frontmatter is not closed with ---`);
    return null;
  }
  const fields = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim() || line.startsWith(' ') || line.startsWith('\t')) continue;
    const at = line.indexOf(':');
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: normalized.slice(end + 5) };
}

function checkSkill(dir) {
  const name = dir;
  const file = join(SKILLS, name, 'SKILL.md');
  const rel = relative(ROOT, file);
  let text;
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`${dir}: missing skills/${name}/SKILL.md`);
    return;
  }
  const parsed = parseFrontmatter(text, rel);
  if (!parsed) return;
  const { fields, body } = parsed;

  if (!fields.name) fail(`${rel}: frontmatter is missing "name"`);
  else if (fields.name !== name) fail(`${rel}: name "${fields.name}" does not match directory "${name}"`);
  else if (!SKILL_NAME.test(fields.name)) fail(`${rel}: name must be lowercase words joined by "-"`);

  const description = fields.description || '';
  if (!description) fail(`${rel}: frontmatter is missing "description"`);
  else if (!description.startsWith('Use when')) fail(`${rel}: description should start with "Use when"`);
  else if (description.length > 1024) fail(`${rel}: description is ${description.length} chars (max 1024)`);

  if (!body.trim()) fail(`${rel}: body is empty`);
  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) fail(`${rel}: unbalanced code fences`);

  skills.push({ name, description: description.length });
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name === 'SKILL.md') {
      const rel = relative(ROOT, path).split('\\').join('/');
      if (!rel.startsWith('skills/') && !rel.startsWith('archive/')) {
        fail(`${rel}: SKILL.md outside skills/ would be discovered as a stray skill`);
      }
    }
  }
}

let dirs = [];
try {
  dirs = readdirSync(SKILLS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
} catch {
  fail('skills/ directory is missing');
}

for (const dir of dirs) checkSkill(dir);
walk(ROOT);

if (skills.length === 0) fail('no skills found under skills/');

if (errors.length) {
  for (const message of errors) console.error(`error: ${message}`);
  process.exit(1);
}

for (const skill of skills) console.log(`ok: ${skill.name} (description: ${skill.description} chars)`);
console.log(`validated ${skills.length} skill(s)`);
