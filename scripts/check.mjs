#!/usr/bin/env node
// Everything CI checks on every pull request, in one command for contributors:
//   node scripts/check.mjs           all checks
//   node scripts/check.mjs --no-test everything but the test suite (quick, before a commit)
// Steps: skills follow the spec, generated files are up to date, every tracked script parses,
// every tracked JSON file parses, and the node:test suite in test/ passes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }).status === 0;
const tracked = (...patterns) =>
  spawnSync('git', ['ls-files', '-z', '--', ...patterns], { cwd: root, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);

const steps = [
  ['Skills follow the Agent Skills spec', () => node(['scripts/validate-skills.mjs'])],
  ['Generated agents and manifests are up to date', () => node(['scripts/build.mjs', '--check'])],
  [
    'Scripts parse',
    () => {
      const files = tracked('*.mjs', '*.js');
      const bad = files.filter((f) => spawnSync(process.execPath, ['--check', f], { cwd: root, stdio: 'inherit' }).status !== 0);
      console.log(bad.length ? `${bad.length} of ${files.length} scripts do not parse` : `${files.length} scripts parse`);
      return !bad.length;
    },
  ],
  [
    'JSON files parse',
    () => {
      const files = tracked('*.json');
      const bad = files.filter((f) => {
        try {
          JSON.parse(readFileSync(join(root, f), 'utf8').replace(/^﻿/, ''));
          return false;
        } catch (error) {
          console.error(`${f}: ${error.message}`);
          return true;
        }
      });
      console.log(bad.length ? `${bad.length} of ${files.length} JSON files do not parse` : `${files.length} JSON files parse`);
      return !bad.length;
    },
  ],
  ['Tests pass', () => node(['--test']), 'test'],
];

const skip = new Set(process.argv.slice(2).filter((a) => a.startsWith('--no-')).map((a) => a.slice(5)));
const failed = [];
for (const [title, run, key] of steps) {
  if (key && skip.has(key)) continue;
  console.log(`\n▶ ${title}`);
  if (!run()) failed.push(title);
}
console.log(failed.length ? `\n✖ ${failed.length} check(s) failed: ${failed.join('; ')}` : '\n✔ all checks passed');
process.exit(failed.length ? 1 : 0);
