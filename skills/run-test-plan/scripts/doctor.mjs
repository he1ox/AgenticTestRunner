// `doctor`: what this machine and project still need before a run, whatever the agent harness.
// Read-only: it reports and prints the fix, the human (or the qa-setup skill) applies it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserArgs } from './agents.mjs';
import { browserRegistration, resolveHarness } from './harness.mjs';
import { CONFIG_FILE, PROJECT_ROOT, SKILL_DIR } from './lib.mjs';
import { McpClient } from './mcp-client.mjs';

// npx is a .cmd on Windows, so it needs a shell there; the arguments are fixed literals.
const runs = (command, args) => {
  const options = { encoding: 'utf8', windowsHide: true, timeout: 30000 };
  const out = process.platform === 'win32' ? spawnSync([command, ...args].join(' '), { ...options, shell: true }) : spawnSync(command, args, options);
  return out.status === 0 ? (out.stdout || out.stderr).trim().split('\n')[0] : null;
};

// Each check: ok true (fine), false (must fix), null (optional, missing).
export async function doctor({ harness: flag, browser = false } = {}) {
  const checks = [];
  const add = (ok, label, fix) => checks.push({ ok, label, fix });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20, `Node.js ${process.versions.node}`, major >= 20 ? null : 'install Node.js 20 or later');

  const npx = runs('npx', ['--version']);
  add(Boolean(npx), npx ? `npx ${npx}` : 'npx not found', npx ? null : 'npx comes with npm; the browser server runs Playwright MCP through it');

  const ffmpeg = runs('ffmpeg', ['-version']);
  add(ffmpeg ? true : null, ffmpeg ? 'ffmpeg found' : 'ffmpeg not found (only needed for recordings)', ffmpeg ? null : 'winget install Gyan.FFmpeg | brew install ffmpeg | sudo apt install ffmpeg');

  add(existsSync(CONFIG_FILE) || null, existsSync(CONFIG_FILE) ? '.qa/config.json found' : 'no .qa/config.json', existsSync(CONFIG_FILE) ? null : 'optional: the qa-setup skill writes one (schemas/config.schema.json)');

  const gitignore = join(PROJECT_ROOT, '.gitignore');
  const ignored = existsSync(gitignore) && /^\/?\.qa\/runs\/?\s*$/m.test(readFileSync(gitignore, 'utf8'));
  add(ignored, ignored ? '.qa/runs/ is git-ignored' : '.qa/runs/ is not in .gitignore', ignored ? null : 'add the line .qa/runs/ to .gitignore (runs hold screenshots and videos)');

  let harness;
  try {
    harness = resolveHarness(flag);
    add(true, `harness ${harness}`, null);
  } catch (error) {
    add(false, error.message, 'pass --harness or set "harness" in .qa/config.json');
  }

  const script = join(SKILL_DIR, 'scripts', 'browser-mcp.mjs').split('\\').join('/');
  if (harness)
    add(
      null,
      harness === 'claude-code'
        ? 'browser: the qa-runner plugin brings its own; without the plugin register one'
        : 'browser: installed as a plugin/extension it is registered for you; otherwise register it',
      browserRegistration(harness, script),
    );

  if (browser) {
    const client = new McpClient('npx', browserArgs('doctor', { headless: true }));
    try {
      await client.start();
      const { tools = [] } = await client.request('tools/list', {});
      const names = new Set(tools.map((t) => t.name));
      const missing = ['browser_navigate', 'browser_run_code_unsafe', 'browser_find'].filter((t) => !names.has(t));
      add(!missing.length, `Playwright MCP answers with ${tools.length} tools`, missing.length ? `missing ${missing.join(', ')}: set QA_PLAYWRIGHT_MCP to a newer @playwright/mcp` : null);
    } catch (error) {
      add(false, `Playwright MCP did not start: ${error.message}`, 'check npx and network access, then run doctor --browser again');
    } finally {
      await client.close().catch(() => {});
    }
  }
  return checks;
}
