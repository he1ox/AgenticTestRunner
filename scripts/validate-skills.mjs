#!/usr/bin/env node
// Checks every skill against the Agent Skills spec (agentskills.io/specification) and this repo's
// own rules, so a skill that `npx skills add` or a harness would reject, or that points at a file
// that is not there, fails CI instead of a user's install:
//   - frontmatter: name (1-64, a-z 0-9 and single hyphens, equal to its folder), description
//     (1-1024), compatibility (<= 500), license, metadata.version equal to the plugin version;
//   - SKILL.md under 500 lines;
//   - every relative path a skill's Markdown names (links and `code` paths) exists;
//   - every manifest carries the same version as .claude-plugin/plugin.json.
// Zero dependencies: the frontmatter parser reads the flat YAML subset these skills use.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const error = (file, message) => errors.push(`${relative(root, file).split('\\').join('/')}: ${message}`);
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

const version = readJson('.claude-plugin/plugin.json').version;

// `key: value` and one level of `key:` + indented `  sub: value`; values may be quoted.
export function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return null;
  const data = {};
  let parent = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) return { __error: `cannot parse frontmatter line: ${line}` };
    const [, indent, key, raw] = m;
    const value = raw.replace(/^(["'])(.*)\1$/, '$2');
    if (indent && parent) data[parent][key] = value;
    else if (!raw) data[(parent = key)] = {};
    else {
      parent = null;
      data[key] = value;
    }
  }
  return data;
}

const skillsDir = join(root, 'skills');
const skills = readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md')));
if (!skills.length) error(skillsDir, 'no skills found');

const markdownFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'viewer' || name === 'scripts' ? [] : markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });

// Paths a skill names: Markdown links, and `code` spans that look like a file in the skill.
const PATH_IN_CODE = /`((?:\.\.\/[\w.-]+\/)?(?:references|schemas|scripts|assets)\/[\w./-]+\.\w+)`/g;
const LINK = /\]\((?!https?:|#|mailto:)([^)\s]+)\)/g;

for (const dirName of skills) {
  const dir = join(skillsDir, dirName);
  const file = join(dir, 'SKILL.md');
  const text = readFileSync(file, 'utf8');
  const fm = frontmatter(text);
  if (!fm) {
    error(file, 'missing YAML frontmatter');
    continue;
  }
  if (fm.__error) error(file, fm.__error);
  const { name, description, compatibility, license, metadata } = fm;
  if (!name) error(file, 'name is required');
  else {
    if (name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
      error(file, `name "${name}" must be 1-64 lowercase letters, digits and single hyphens`);
    if (name !== dirName) error(file, `name "${name}" must match its folder "${dirName}"`);
  }
  if (!description) error(file, 'description is required');
  else if (description.length > 1024) error(file, `description is ${description.length} characters (max 1024)`);
  if (compatibility && compatibility.length > 500) error(file, `compatibility is ${compatibility.length} characters (max 500)`);
  if (!license) error(file, 'license is required in this repo');
  if (metadata?.version !== version) error(file, `metadata.version "${metadata?.version}" differs from the plugin version ${version}`);
  const lines = text.split('\n').length;
  if (lines >= 500) error(file, `${lines} lines; keep SKILL.md under 500 and move detail to references/`);

  for (const md of markdownFiles(dir)) {
    const body = readFileSync(md, 'utf8');
    for (const [, target] of [...body.matchAll(LINK), ...body.matchAll(PATH_IN_CODE)]) {
      if (/[<>*{}]/.test(target)) continue;
      // Skills name paths from their own folder; a Markdown link may also be relative to its file.
      const path = target.split('#')[0];
      if (!existsSync(join(dir, path)) && !existsSync(join(dirname(md), path))) error(md, `names ${target}, which does not exist`);
    }
  }
}

const manifests = {
  'plugin.json': (m) => m.version,
  'gemini-extension.json': (m) => m.version,
  '.codex-plugin/plugin.json': (m) => m.version,
};
for (const [file, get] of Object.entries(manifests)) {
  if (!existsSync(join(root, file))) error(join(root, file), 'missing; run node scripts/build.mjs');
  else if (get(readJson(file)) !== version) error(join(root, file), `version ${get(readJson(file))} differs from ${version}; run node scripts/build.mjs`);
}
const agentPlugin = readJson('plugin.json');
if (!/^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$/.test(agentPlugin.name) || /--|\.\./.test(agentPlugin.name))
  error(join(root, 'plugin.json'), `name "${agentPlugin.name}" breaks the Agent Plugins naming rules`);

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  console.error(`${errors.length} problem(s) in ${skills.length} skill(s)`);
  process.exit(1);
}
console.log(`✓ ${skills.length} skills valid (${skills.join(', ')}), manifests at ${version}`);
