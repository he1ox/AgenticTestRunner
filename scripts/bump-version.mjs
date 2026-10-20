#!/usr/bin/env node
// Sets one version everywhere: .claude-plugin/plugin.json (the source build.mjs copies into the
// other manifests), every SKILL.md's metadata.version, the skill README's table and the landing
// page (site/index.html); then rebuilds the manifests. Usage: node scripts/bump-version.mjs 0.8.0
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next || '')) {
  console.error('usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(1);
}

const edit = (file, change) => {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`${file}: version not found`);
  writeFileSync(path, after);
  console.log(`updated ${file}`);
};

edit('.claude-plugin/plugin.json', (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
for (const skill of readdirSync(join(root, 'skills'))) {
  const file = join('skills', skill, 'SKILL.md');
  if (existsSync(join(root, file))) edit(file, (s) => s.replace(/^(\s+version:\s*)"[^"]*"/m, `$1"${next}"`));
}
const readme = join('skills', 'run-test-plan', 'README.md');
if (existsSync(join(root, readme))) edit(readme, (s) => s.replace(/(\| Version \| )[^|]+( \|)/, `$1${next}$2`));
edit(join('site', 'index.html'), (s) => s.replace(/(<span data-version>v)[^<]+(<)/, `$1${next}$2`));
execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
