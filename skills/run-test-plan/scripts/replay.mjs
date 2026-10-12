// Deterministic runs of a suite (a "Test plan" in the viewer): every script in the test library
// replays without an agent, in its own Playwright MCP browser driven over stdio, so a run costs no
// tokens and does the same thing every time. Each recorded capture is taken again with the same
// file name and marks (a mark whose element is gone fails the step), recordings start and stop
// where they did, and the run lands in .qa/runs/ like any other, so the viewer, review and
// retest work unchanged.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { browserArgs } from './agents.mjs';
import { McpClient, sections } from './mcp-client.mjs';
import { execution } from './schedule.mjs';
import { captureCode, fillPaths, fillSecrets, needsSecret, readSuite, readTest, recordingCode, updateTest } from './tests.mjs';
import { CONFIG, PROJECT_ROOT, readJson, runDir, stamp, tcDir, writeJson } from './lib.mjs';

const ANSI = /\x1b\[[0-9;]*m/g;
const actionTimeout = () => Math.max(1000, Number(CONFIG.execution?.replayTimeoutMs) || 15000);
const navigationTimeout = () => Math.max(5000, Number(CONFIG.execution?.replayNavigationTimeoutMs) || 60000);
// Tools after which the page may navigate: give it a moment to load before the next action, since
// a replay runs far faster than the agent that recorded it.
const SETTLE = new Set(['click', 'navigate', 'navigate_back', 'press_key', 'select_option', 'type', 'fill_form']);

// Freezes the suite into a new run folder and returns its id at once; executeRun does the work.
export function prepareSuiteRun(suiteId, { label } = {}) {
  const suite = readSuite(suiteId);
  if (!suite) throw Object.assign(new Error(`unknown test plan ${suiteId}`), { status: 404 });
  const warnings = [];
  const tests = [];
  for (const id of suite.tests) {
    const test = readTest(id);
    if (test) tests.push(test);
    else warnings.push(`${id} is not in the test library any more; skipped.`);
  }
  if (!tests.length) throw Object.assign(new Error(`test plan "${suite.name}" has no tests to run`), { status: 400 });

  // Cases of one source group run together, in recording order, in one browser.
  const groupKey = (t) => `${t.planId}.${t.group || t.tcId}`;
  const groups = [...new Set(tests.map(groupKey))];
  tests.sort((a, b) => groups.indexOf(groupKey(a)) - groups.indexOf(groupKey(b)) || (a.order ?? 0) - (b.order ?? 0));
  const included = new Set(tests.map((t) => t.id));
  for (const t of tests) {
    const missing = (t.recordedAfter || []).filter((tc) => !included.has(`${t.planId}/${tc}`));
    if (missing.length)
      warnings.push(`${t.id} was recorded right after ${missing.join(', ')} (same session, no separate login), which this plan does not include; it may depend on them.`);
  }

  const runId = `${suite.id}_${stamp()}`;
  const dir = runDir(runId);
  if (existsSync(dir)) throw new Error(`run ${runId} already exists; try again in a second`);
  const testCases = tests.map((t) => ({
    id: `${t.planId}.${t.tcId}`,
    title: t.title,
    group: groupKey(t),
    variants: t.variants || {},
    tags: t.tags || [],
    ...(t.preconditions && { preconditions: t.preconditions }),
    ...(t.data && { data: t.data }),
    steps: t.steps.map(({ n, action, expected }) => ({ n, action, ...(expected && { expected }) })),
    expected: t.expected,
    record: Boolean(t.record),
    tool: 'playwright-mcp',
    ...(t.target?.app && { environment: { targets: { app: t.target.app } } }),
    source: { planId: t.planId, tcId: t.tcId, version: t.version, group: t.group, order: t.order },
  }));
  const first = tests.find((t) => t.target?.app) || tests[0];
  writeJson(join(dir, 'plan.json'), {
    schemaVersion: 2,
    id: suite.id,
    title: suite.name,
    environment: {
      name: 'replay',
      targets: { app: first.target?.app || '' },
      ...(first.account?.user && { user: first.account.user }),
    },
    testCases,
  });
  writeJson(join(dir, 'meta.json'), {
    createdAt: new Date().toISOString(),
    label: label || suite.name,
    mode: 'replay',
    suite: { id: suite.id, name: suite.name, tags: suite.tags || [] },
    recordAll: false,
    retestOf: null,
    warnings,
  });
  writeJson(join(dir, 'review.json'), {});
  for (const tc of testCases) mkdirSync(join(tcDir(runId, tc.id), 'evidence'), { recursive: true });
  return { runId, warnings };
}

export function credentials(test) {
  const user = test.account?.user ?? null;
  const ref = test.account?.secret || execution().accounts.find((a) => a.user === user)?.secret || null;
  const env = ref?.startsWith('env:') ? ref.slice(4) : 'QA_PASSWORD';
  return { user, secret: process.env[env] ?? null, env };
}

function mark(runId, tcId, state, note = null) {
  const base = tcDir(runId, tcId);
  const at = new Date().toISOString();
  writeJson(join(base, 'progress.json'), { state, note, at });
  if (state === 'running') writeJson(join(base, 'timing.json'), { startedAt: at });
}

const errorOf = (text) =>
  (sections(text).get('Error') || text)
    .replace(ANSI, '')
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 4)
    .join(' ')
    .slice(0, 600);

// One recorded action → one browser_run_code_unsafe call. Returns { output } or { error }.
async function runAction(client, runId, tcId, action, creds) {
  let code;
  if (action.kind === 'code') {
    const settle = SETTLE.has(action.tool)
      ? "\n  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});"
      : '';
    // A missing element should fail the step in seconds, not after Playwright's 30 s default.
    // Pages with slow third-party resources reach "load" late, so navigation gets its own, longer wait.
    code = `async (page) => {\n  page.setDefaultTimeout(${actionTimeout()});\n  page.setDefaultNavigationTimeout(${navigationTimeout()});\n${fillSecrets(action.code, creds)}${settle}\n}`;
  } else if (action.kind === 'capture' && action.code) code = fillSecrets(fillPaths(action.code, runId, tcId), creds);
  else if (action.kind === 'capture')
    code = captureCode(runId, tcId, {
      file: action.file,
      marks: fillSecrets(action.marks || '[]', creds),
      strict: true,
      optional: action.optional || [],
    });
  else if (action.kind === 'rec') code = recordingCode(runId, tcId, action.action);
  else return { error: `unknown action kind "${action.kind}"` };
  try {
    const reply = await client.call('browser_run_code_unsafe', { code }, 200000);
    if (process.env.QA_REPLAY_DEBUG) console.error('ACTION', action.kind, action.file || '', `\n${code.slice(0, 300)}\n=> ${reply.text.slice(0, 300)}`);
    if (reply.isError) return { error: errorOf(reply.text) };
    const output = (sections(reply.text).get('Result') || '').replace(/^"|"$/g, '');
    if (action.kind === 'capture' && output.startsWith('MISSING ')) {
      const missing = output.slice(8, output.indexOf(';'));
      return { error: `expected element(s) not found on the page: ${missing}`, output };
    }
    return { output };
  } catch (error) {
    return { error: String(error.message || error) };
  }
}

const kindOf = (file) =>
  /\.(png|jpe?g|webp|gif)$/i.test(file)
    ? 'screenshot'
    : /\.(mp4|webm)$/i.test(file)
      ? 'video'
      : /\.json$/i.test(file)
        ? 'json'
        : /\.(log|txt)$/i.test(file)
          ? 'log'
          : 'text';

function evidenceFiles(runId, tcId) {
  const dir = join(tcDir(runId, tcId), 'evidence');
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => !f.startsWith('.') && !f.endsWith('.annotations.json') && statSync(join(dir, f)).isFile())
    : [];
}

function nextPrefix(files) {
  const used = files.map((f) => Number(/^(\d+)-/.exec(f)?.[1] || 0));
  return String(Math.max(0, ...used) + 1).padStart(2, '0');
}

function writeResult(runId, tc, test, { status, summary, steps, notes = '', blockedReason, startedAt }) {
  const files = evidenceFiles(runId, tc.id);
  const result = {
    schemaVersion: 2,
    testCaseId: tc.id,
    status,
    summary,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: { variants: tc.variants || {} },
    steps,
    evidence: files.map((file) => ({ file, kind: kindOf(file), caption: /-failure\./.test(file) ? 'Page when the replay failed' : '' })),
    data: {},
    defects: [],
    learnings: [],
    notes,
    ...(blockedReason && { blockedReason }),
    executedBy: { mode: 'replay', script: test.id, version: test.version },
  };
  writeJson(join(tcDir(runId, tc.id), 'result.json'), result);
  try {
    updateTest(test.id, { lastReplay: { runId, status, at: result.finishedAt } });
  } catch {
    // the test was removed while the run was going
  }
  return result;
}

function blockAll(runId, tc, test, reason, blockedReason, startedAt) {
  return writeResult(runId, tc, test, {
    status: 'blocked',
    summary: reason,
    blockedReason,
    startedAt,
    steps: tc.steps.map((s) => ({ n: s.n, status: 'blocked', actual: reason, evidence: [] })),
  });
}

async function replayCase(client, runId, tc, test, creds, recordings) {
  const startedAt = new Date().toISOString();
  const outcome = new Map();
  let failure = null;
  let recording = false;
  const exists = () => new Set(evidenceFiles(runId, tc.id));
  for (const step of test.steps) {
    if (!step.actions.length) continue;
    if (failure) {
      outcome.set(step.n, { status: 'blocked', actual: `Not run: step ${failure.step} failed first.` });
      continue;
    }
    let done = 0;
    for (const action of step.actions) {
      // Without ffmpeg (CI mode checks) a recording cannot be stitched: skip it, keep the rest.
      if (action.kind === 'rec' && !recordings) {
        done += 1;
        continue;
      }
      const { error } = await runAction(client, runId, tc.id, action, creds);
      if (action.kind === 'rec' && !error) recording = action.action === 'start';
      if (error) {
        failure = { step: step.n, error, action };
        break;
      }
      done += 1;
    }
    outcome.set(
      step.n,
      failure?.step === step.n
        ? { status: 'fail', actual: `Replay failed at action ${done + 1} of ${step.actions.length}: ${failure.error}` }
        : {
            status: 'pass',
            actual: `Replayed ${step.actions.length} recorded action(s)${step.actions.some((a) => a.kind === 'capture') ? '; every marked element was on the page' : ''}.`,
          },
    );
  }
  let failureShot = null;
  if (failure) {
    failureShot = `${nextPrefix([...exists()])}-failure.png`;
    await runAction(client, runId, tc.id, { kind: 'capture', file: failureShot, marks: '[]' }, creds);
  }
  if (recording) await runAction(client, runId, tc.id, { kind: 'rec', action: 'stop' }, creds);

  const files = exists();
  const videos = [...files].filter((f) => /\.(mp4|webm)$/i.test(f));
  const steps = test.steps.map((step) => {
    const own = outcome.get(step.n);
    const covered = !own && step.coveredBy !== undefined ? outcome.get(step.coveredBy) : null;
    const state = own || covered || { status: 'n/a', actual: 'No recorded action for this step.' };
    let evidence = (step.evidence || []).filter((f) => files.has(f));
    if (covered) evidence = (test.steps.find((s) => s.n === step.coveredBy)?.evidence || []).filter((f) => files.has(f));
    if (state.status === 'fail' && failureShot && files.has(failureShot)) evidence = [...evidence, failureShot];
    if (!evidence.length && state.status === 'pass' && videos.length) evidence = [videos[0]];
    return {
      n: step.n,
      status: state.status,
      actual: covered ? `${state.actual} (performed together with step ${step.coveredBy})` : state.actual,
      evidence,
    };
  });
  const total = test.steps.filter((s) => s.actions.length).length;
  const passed = steps.filter((s) => s.status === 'pass').length;
  return writeResult(runId, tc, test, {
    status: failure ? 'fail' : 'pass',
    summary: failure
      ? `Replay of script v${test.version} failed at step ${failure.step}: ${failure.error.slice(0, 160)}`
      : `Deterministic replay of script v${test.version}: all ${passed} step(s) reproduced the recorded result.`,
    notes: failure
      ? `Step ${failure.step} failed during replay: ${failure.error}\nEither the product regressed, or the UI changed on purpose and the script is stale: use "Repair with agent" to re-record it.`
      : `${total} step(s) with actions; screenshots and marks retaken as recorded.`,
    steps,
    startedAt,
  });
}

async function replayGroup(runId, cases, { headed, recordings, slot, log }) {
  let client;
  try {
    client = await new McpClient('npx', browserArgs(`replay-${slot}`, { headless: !headed }), { cwd: PROJECT_ROOT }).start();
  } catch (error) {
    for (const { tc, test } of cases)
      blockAll(runId, tc, test, `The replay browser did not start: ${error.message}`, 'environment', new Date().toISOString());
    return;
  }
  let setupDone = false;
  let setupError = null;
  try {
    for (const { tc, test } of cases) {
      const startedAt = new Date().toISOString();
      mark(runId, tc.id, 'running', 'deterministic replay');
      log(`${tc.id} running`);
      const creds = credentials(test);
      if (needsSecret(test) && creds.secret === null) {
        blockAll(runId, tc, test, `The script types a password; set the environment variable ${creds.env} before running.`, 'environment', startedAt);
        log(`${tc.id} blocked (no ${creds.env})`);
        continue;
      }
      if (!setupDone && test.setup?.length) {
        setupDone = true;
        for (const action of test.setup) {
          const { error } = await runAction(client, runId, tc.id, action, creds);
          if (error) {
            setupError = error;
            break;
          }
        }
      }
      if (setupError) {
        blockAll(runId, tc, test, `The recorded setup (login) failed: ${setupError}`, 'environment', startedAt);
        log(`${tc.id} blocked (setup failed)`);
        continue;
      }
      const result = await replayCase(client, runId, tc, test, creds, recordings);
      log(`${tc.id} ${result.status.toUpperCase()} — ${result.summary}`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

// Runs every case of a prepared run. Groups run one at a time unless the app allows one user in
// several browsers at once (execution.sessions "shared"), then up to execution.maxParallel.
export async function executeRun(runId, { headed = false, recordings = true, log = () => {} } = {}) {
  const plan = readJson(join(runDir(runId), 'plan.json'));
  const groups = new Map();
  for (const tc of plan.testCases) {
    const test = readTest(`${tc.source.planId}/${tc.source.tcId}`);
    if (!test) {
      blockAll(runId, tc, { id: `${tc.source.planId}/${tc.source.tcId}`, version: tc.source.version, steps: [] }, 'The script was removed from the test library.', 'environment', new Date().toISOString());
      continue;
    }
    if (!groups.has(tc.group)) groups.set(tc.group, []);
    groups.get(tc.group).push({ tc, test });
  }
  const ex = execution();
  const limit = ex.sessions === 'shared' ? ex.maxParallel : 1;
  const queue = [...groups.values()];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async (_, i) => {
    while (queue.length) await replayGroup(runId, queue.shift(), { headed, recordings, slot: i + 1, log });
  });
  await Promise.all(workers);
  writeJson(join(runDir(runId), 'meta.json'), { ...readJson(join(runDir(runId), 'meta.json'), {}), finishedAt: new Date().toISOString() });
}
