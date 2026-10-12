// CI mode for deterministic replays (`suite run <id> --ci`, `replay <runId> --ci`): no viewer
// window and no agent, a short per-case summary, an optional JUnit report, and an exit code a
// pipeline can gate on. The viewer server still runs, as a child of this process, because
// captures and recordings talk to it; it stops with the run.
//
// Exit codes: 0 the gate passed, 1 a case ended in a --fail-on status (or never finished),
// 2 the run could not start (unknown plan, missing secret, server or flag problem).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { credentials, executeRun, prepareSuiteRun } from './replay.mjs';
import { needsSecret, readSuite, readTest } from './tests.mjs';
import { PORT, PROJECT_ROOT, SKILL_DIR, displayPath, loadRun, readJson, runDir, serverUp, tcDir } from './lib.mjs';

export const FAIL_ON = ['fail', 'blocked'];
const ANSI = /\x1b\[[0-9;]*m/g;

class SetupError extends Error {}

// "fail", "blocked", "fail,blocked" or "none"; default both.
export function parseFailOn(value) {
  if (value === undefined || value === true) return new Set(FAIL_ON);
  const list = String(value).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 1 && list[0] === 'none') return new Set();
  const unknown = list.filter((s) => !FAIL_ON.includes(s));
  if (!list.length || unknown.length) throw new SetupError(`--fail-on takes fail, blocked, fail,blocked or none (got "${value}")`);
  return new Set(list);
}

// Every password a run will type must be in the environment before anything starts: a CI job
// should stop with the variable's name, not after the first login times out.
function missingSecrets(tests) {
  const missing = new Map();
  for (const test of tests) {
    if (!needsSecret(test)) continue;
    const { env, secret } = credentials(test);
    if (secret === null) missing.set(env, [...(missing.get(env) || []), test.id]);
  }
  return missing;
}

const hasFfmpeg = () => {
  const out = spawnSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 15000 });
  return out.status === 0;
};

// Reuses a viewer server already answering on the port (a developer's machine); otherwise starts
// one attached to this process and stops it at the end, so the CI step does not leave it behind.
async function startServer() {
  if (await serverUp()) return { stop: () => {}, reused: true };
  let stderr = '';
  let exited = null;
  const child = spawn(process.execPath, [join(SKILL_DIR, 'scripts', 'server.mjs')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    cwd: PROJECT_ROOT,
    env: { ...process.env, QA_PROJECT_DIR: PROJECT_ROOT },
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('exit', (code) => (exited = code));
  for (let i = 0; i < 60 && exited === null; i += 1) {
    if (await serverUp()) return { stop: () => child.kill(), reused: false };
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new SetupError(`the viewer server did not start on port ${PORT} (captures need it): ${stderr.trim() || 'no answer'}. Set QA_VIEWER_PORT to a free port.`);
}

const seconds = (from, to) => {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : 0;
};

// What decides the job for one case: ok, gate (a --fail-on status) or error (never finished).
function verdict(status, failOn) {
  if (status === 'pass' || status === 'skipped') return 'ok';
  if (status === 'fail' || status === 'blocked') return failOn.has(status) ? 'gate' : 'ok';
  return 'error';
}

// ---------------------------------------------------------------------------------------------
// JUnit XML: one <testsuite> for the Test plan, one <testcase> per case (classname = source plan).
// Evidence paths are relative to the project root, like the uploaded run folder.

const xmlText = (value) =>
  String(value ?? '')
    .replace(ANSI, '')
    // XML 1.0 forbids most control characters, even escaped.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const xmlAttr = (value) => xmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
const attrs = (pairs) =>
  Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${xmlAttr(v)}"`)
    .join('');

export function junitXml(run, { failOn = new Set(FAIL_ON) } = {}) {
  const meta = run.meta || {};
  const name = meta.suite?.name || run.plan.title || run.id;
  const cases = [];
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  for (const tc of run.testCases) {
    const result = tc.result && !tc.result.__parseError ? tc.result : null;
    const time = result ? seconds(result.startedAt, result.finishedAt) : 0;
    const source = tc.source || {};
    const evidence = tc.files.map((f) => displayPath(join(tcDir(run.id, tc.id), 'evidence', f)));
    const steps = (result?.steps || []).map((s) => `step ${s.n} ${s.status}: ${s.actual || ''}`).join('\n');
    const message = result?.summary || `the case did not finish (status ${tc.status})`;
    const body = [result?.notes, steps].filter(Boolean).join('\n\n');
    let outcome = '';
    const v = verdict(tc.status, failOn);
    if (v === 'error') {
      totals.errors += 1;
      outcome = `      <error${attrs({ type: 'incomplete', message })}>${xmlText(body)}</error>\n`;
    } else if (v === 'gate' && tc.status === 'fail') {
      totals.failures += 1;
      outcome = `      <failure${attrs({ type: 'fail', message })}>${xmlText(body)}</failure>\n`;
    } else if (v === 'gate') {
      totals.errors += 1;
      outcome = `      <error${attrs({ type: `blocked${result?.blockedReason ? `:${result.blockedReason}` : ''}`, message })}>${xmlText(body)}</error>\n`;
    } else if (tc.status !== 'pass') {
      // skipped, or fail/blocked left out of --fail-on: reported, not counted against the job
      totals.skipped += 1;
      outcome = `      <skipped${attrs({ message: `${tc.status}: ${message}` })}/>\n`;
    }
    totals.tests += 1;
    totals.time += time;
    const properties = [
      ['status', tc.status],
      ['script', result?.executedBy?.script || (source.planId ? `${source.planId}/${source.tcId}` : '')],
      ['version', result?.executedBy?.version ?? source.version],
      ...evidence.map((path) => ['attachment', path]),
    ].filter(([, v]) => v !== undefined && v !== null && v !== '');
    const out = [result?.summary, ...evidence.map((path) => `[[ATTACHMENT|${path}]]`)].filter(Boolean).join('\n');
    cases.push(
      `    <testcase${attrs({ classname: source.planId || run.plan.id || run.id, name: `${source.tcId || tc.id}: ${tc.title}`, time: time.toFixed(3) })}>\n` +
        `      <properties>\n${properties.map(([k, v]) => `        <property${attrs({ name: k, value: v })}/>`).join('\n')}\n      </properties>\n` +
        outcome +
        (out ? `      <system-out>${xmlText(out)}</system-out>\n` : '') +
        '    </testcase>',
    );
  }
  const counts = { tests: totals.tests, failures: totals.failures, errors: totals.errors, skipped: totals.skipped, time: totals.time.toFixed(3) };
  const timestamp = (meta.createdAt || '').slice(0, 19);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites${attrs({ name: 'qa-runner', ...counts })}>\n` +
    `  <testsuite${attrs({ name, id: run.id, ...counts, timestamp })}>\n` +
    `    <properties>\n${[
      ['run', displayPath(runDir(run.id))],
      ['suite', meta.suite?.id],
      ['fail-on', [...failOn].join(',') || 'none'],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `      <property${attrs({ name: k, value: v })}/>`)
      .join('\n')}\n    </properties>\n` +
    (cases.length ? `${cases.join('\n')}\n` : '') +
    '  </testsuite>\n</testsuites>\n'
  );
}

export function writeJunit(runId, path, options) {
  const file = resolve(PROJECT_ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, junitXml(loadRun(runId), options));
  return file;
}

// ---------------------------------------------------------------------------------------------

function summarize(run, failOn, elapsed, log) {
  const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, other: 0 };
  let failed = 0;
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  log('');
  for (const tc of run.testCases) {
    const status = tc.status in counts ? tc.status : 'other';
    counts[status] += 1;
    const v = verdict(tc.status, failOn);
    if (v !== 'ok') failed += 1;
    const time = tc.result ? ` (${seconds(tc.result.startedAt, tc.result.finishedAt).toFixed(1)}s)` : '';
    log(`${String(tc.status).toUpperCase().padEnd(8)} ${tc.id}  ${tc.title}${time}`);
    if (tc.status === 'pass') continue;
    const why = tc.result?.summary || 'the case did not finish';
    log(`         ${why}`);
    const failure = tc.files.find((f) => /-failure\./.test(f));
    if (failure) log(`         ${displayPath(join(tcDir(run.id, tc.id), 'evidence', failure))}`);
    if (annotate && v !== 'ok') console.log(`::error title=${tc.id} ${tc.status}::${why.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  }
  const parts = [`${counts.pass} passed`, `${counts.fail} failed`, `${counts.blocked} blocked`, `${counts.skipped} skipped`];
  if (counts.other) parts.push(`${counts.other} unfinished`);
  log(`\n${run.testCases.length} case(s): ${parts.join(', ')} in ${elapsed.toFixed(1)}s`);
  return failed;
}

// The whole CI path. `suite` prepares a new run from a Test plan; `runId` executes one the viewer
// prepared. Returns the exit code; never throws.
export async function runCi({ suite, runId, label, headed = false, failOn: failOnFlag, junit, log = (line) => console.log(line) }) {
  let server = null;
  try {
    const failOn = parseFailOn(failOnFlag);
    let tests;
    if (suite) {
      const s = readSuite(suite);
      if (!s) throw new SetupError(`unknown test plan ${suite}`);
      tests = s.tests.map(readTest).filter(Boolean);
    } else {
      if (!runId) throw new SetupError('usage: suite run <id> --ci | replay <runId> --ci');
      const plan = readJson(join(runDir(runId), 'plan.json'));
      if (!plan) throw new SetupError(`unknown run ${runId}`);
      tests = plan.testCases.map((tc) => readTest(`${tc.source?.planId}/${tc.source?.tcId}`)).filter(Boolean);
    }
    const missing = missingSecrets(tests);
    if (missing.size)
      throw new SetupError(
        `missing secret(s): ${[...missing].map(([env, ids]) => `${env} (needed by ${ids.join(', ')})`).join('; ')}. ` +
          'Set each as an environment variable of the job, e.g. from your CI secrets.',
      );
    const recordings = hasFfmpeg();
    if (!recordings && tests.some((t) => JSON.stringify([t.setup, t.steps]).includes('"kind":"rec"')))
      log('! ffmpeg not found: recordings are skipped; screenshots and marks still replay.');

    server = await startServer();
    const started = Date.now();
    if (suite) {
      const prepared = prepareSuiteRun(suite, { label });
      runId = prepared.runId;
      for (const w of prepared.warnings) log(`! ${w}`);
    }
    log(`OK run=${runId}`);
    await executeRun(runId, { headed, recordings, log: (line) => log(`  ${line}`) });
    const run = loadRun(runId);
    const failed = summarize(run, failOn, (Date.now() - started) / 1000, log);
    const junitPath = writeJunit(runId, junit && junit !== true ? junit : join(runDir(runId), 'junit.xml'), { failOn });
    log(`junit=${displayPath(junitPath)}`);
    log(`run=${displayPath(runDir(runId))}`);
    log(`${failed ? 'RESULT FAIL' : 'RESULT PASS'} (fail-on: ${[...failOn].join(',') || 'none'})`);
    return failed ? 1 : 0;
  } catch (error) {
    console.error(`ERROR ${error instanceof SetupError ? '' : 'replay crashed: '}${error.message}`);
    return 2;
  } finally {
    server?.stop();
  }
}
