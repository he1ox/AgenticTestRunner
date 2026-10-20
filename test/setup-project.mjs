// lib.mjs resolves the project and reads .qa/config.json when it is first imported, so every test
// file imports this module before any script: it points QA_PROJECT_DIR at a fresh temporary
// project, copied from examples/.qa, and the tests never read or write the checkout's own .qa.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = join(REPO, 'skills', 'run-test-plan', 'scripts');

export function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'qa-runner-test-'));
  cpSync(join(REPO, 'examples', '.qa'), join(dir, '.qa'), {
    recursive: true,
    filter: (src) => !/[\\/]runs([\\/]|$)/.test(src),
  });
  return dir;
}

export const PROJECT = tempProject();
process.env.QA_PROJECT_DIR = PROJECT;
for (const name of ['QA_HARNESS', 'QA_RUNS_DIR', 'QA_VIEWER_PORT', 'CLAUDECODE']) delete process.env[name];
process.on('exit', () => rmSync(PROJECT, { recursive: true, force: true }));
