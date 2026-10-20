// End to end through the CLI, the way an orchestrator drives it: initialize the example plan for
// every harness and check that `next` hands out a Test Agent launch.
import { REPO, SCRIPTS, tempProject } from './setup-project.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { HARNESSES } from '../skills/run-test-plan/scripts/harness.mjs';

const CLI = join(SCRIPTS, 'qa-runs.mjs');
const qa = (project, ...args) =>
  execFileSync(process.execPath, [CLI, '--project', project, ...args], {
    encoding: 'utf8',
    env: { ...process.env, QA_PROJECT_DIR: '', QA_HARNESS: '', CLAUDECODE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('qa-runs CLI', () => {
  test('the example plan passes init --check', () => {
    assert.match(qa(join(REPO, 'examples'), 'init', join(REPO, 'examples', '.qa', 'plans', 'SHOP-42.plan.json'), '--check'), /^OK plan SHOP-42/m);
  });

  for (const harness of HARNESSES) {
    test(`init and next for ${harness}`, (t) => {
      const project = tempProject();
      t.after(() => rmSync(project, { recursive: true, force: true }));
      qa(project, 'init', join(project, '.qa', 'plans', 'SHOP-42.plan.json'), '--harness', harness);
      const run = qa(project, 'latest').trim();
      assert.match(run, /^SHOP-42_\d{8}-\d{6}$/);
      const next = qa(project, 'next', run);
      // Claude Code launches the plugin's own Test Agents; every other harness is named.
      if (harness === 'claude-code') assert.match(next, /^LAUNCH \S+\s+subagent_type=qa-runner:test-agent-1\b/m);
      else assert.match(next, new RegExp(`^LAUNCH \\S+\\s+harness=${harness}\\b`, 'm'));
    });
  }
});
