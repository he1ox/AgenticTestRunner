// The test library. Every case a Test Agent passes becomes a script that replays without an agent:
// Playwright MCP answers each browser tool with the Playwright code it ran ("### Ran Playwright
// code"), so the script is read from the agent's transcript when the orchestrator records the
// batch (`usage --batch --transcript`), at no cost to the agent's context. Captures and recordings
// are kept as what they are (file, marks, start/stop), so a replay takes the same screenshots, with
// the same marks, at the same moments.
//
// Scripts live in .qa/tests/<planId>/<tcId>.json (versioned with the project, reviewed in pull
// requests); the previous version moves to .history/. Suites (the viewer's "Test plans") live in
// .qa/suites/<id>.json and list scripts by id ("SHOP-42/TC-1").
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ranCode } from './mcp-client.mjs';
import { transcriptEvents } from './usage.mjs';
import { PORT, PROJECT_ROOT, SUITES_DIR, TESTS_DIR, displayPath, readJson, safeJoin, tcDir, writeJson } from './lib.mjs';

export const TEST_STATUSES = ['draft', 'verified'];
const BROWSER_TOOL = /^mcp__(?:plugin_qa-runner_qa-browser-\d+|playwright)__(browser_\w+)$/;
const MARK_RUNNING = /\bmark\s+["']?([A-Za-z0-9._-]+)["']?\s+["']?([A-Za-z0-9._-]+)["']?\s+running\b/;
const LOGIN = /Login: user (.+?), password ([\s\S]+?)\. Never write the password/;
const PASSWORD_FILL =
  /((?:getByLabel|getByPlaceholder|getByRole|getByTestId|locator)\([^\n]*?(?:password|contrase|passwd|pwd|clave|\bpin\b)[^\n]*?\)\.(?:fill|type|pressSequentially)\()(['"`])((?:\\.|(?!\2).)*)\2/gi;
const DEFAULT_MARKS = `[
    { selector: 'input[name="email"]', type: 'rect', label: 'Email left empty' },
    { selector: 'text=Email is required', type: 'arrow', label: 'Inline required error' },
  ]`;

// ---------------------------------------------------------------------------------------------
// Snippets the agent runs (and the replay runner regenerates for a new run)

const sq = (value) => `'${String(value).replace(/[\\']/g, '\\$&')}'`;
const annotationsEndpoint = (runId, tcId) =>
  `http://127.0.0.1:${PORT}/api/runs/${encodeURIComponent(runId)}/annotations/${encodeURIComponent(tcId)}/`;
const recordingEndpoint = (runId, tcId) =>
  `http://127.0.0.1:${PORT}/api/rec/${encodeURIComponent(runId)}/${encodeURIComponent(tcId)}`;

// Captures a screenshot and its annotations in one Playwright call: element boxes come from the
// live DOM (text nodes are measured tightly so an arrow lands on the words, not the full-width
// block), then the marks are PUT to the viewer server, which writes the sidecar next to the image.
// strict (replay): a mark whose element is gone is reported as MISSING, which fails the step;
// marks already missing when the agent recorded the script are listed in `optional`.
export function captureCode(runId, tcId, { file = '01-step-slug.png', marks = DEFAULT_MARKS, strict = false, optional = [] } = {}) {
  const evidence = displayPath(join(tcDir(runId, tcId), 'evidence'));
  const absolute = join(tcDir(runId, tcId), 'evidence').split('\\').join('/');
  return `async (page) => {
  const file = ${sq(file)};
  const marks = ${marks};

  const evidence = ${JSON.stringify(strict ? absolute : evidence)};
  const endpoint = ${JSON.stringify(annotationsEndpoint(runId, tcId))};
  const items = [];
  const elements = {};${strict ? `\n  const optional = ${JSON.stringify(optional)};\n  const missing = [];` : ''}
  for (const mark of marks) {
    const handle = await page.locator(mark.selector).first().elementHandle({ timeout: 3000 }).catch(() => null);
    const box =
      handle &&
      (await handle.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        const element = node.getBoundingClientRect();
        const r = text.width > 0 && text.width < element.width - 4 ? text : element;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }));
    if (!box) {${strict ? '\n      if (!optional.includes(mark.selector)) missing.push(mark.selector);' : ''}
      items.push({ type: 'text', x: 12, y: 12, text: 'Not found: ' + mark.selector, color: 'yellow' });
      continue;
    }
    elements[mark.name || mark.label || mark.selector] = box;
    if (mark.type) items.push({ type: mark.type, box, label: mark.label, text: mark.text, color: mark.color, n: mark.n });
  }
  await page.screenshot({ path: evidence + '/' + file, scale: 'css' });
  const response = await page.request
    .put(endpoint + encodeURIComponent(file), {
      headers: { 'x-qa-viewer': '1' },
      data: { author: 'agent', mode: 'replace', items, elements, summary: ${sq(strict ? 'captured by the replay runner' : 'captured by the Test Agent')} },
    })
    .catch((error) => ({ status: () => 0, text: async () => String(error) }));
  return ${strict ? "(missing.length ? 'MISSING ' + JSON.stringify(missing) + '; ' : '') + " : ''}file + ' saved; annotations: ' + response.status() + ' ' + (await response.text());
}
`;
}

// Recording runs inside the Playwright MCP process, which has no file system access, so frames
// stream over HTTP to the viewer server, which stitches them with ffmpeg on stop.
export function recordingCode(runId, tcId, action) {
  const endpoint = JSON.stringify(recordingEndpoint(runId, tcId));
  if (action === 'start')
    return `async (page) => {
  const endpoint = ${endpoint};
  if (page.__qaRec) return 'already recording';
  const health = await page.request.get(endpoint.replace(/\\/api\\/rec\\/.*/, '/api/health')).catch(() => null);
  if (!health || !health.ok()) return 'viewer server is not running: run qa-runs.mjs open first';
  await page.request.post(endpoint + '/start');
  const session = await page.context().newCDPSession(page);
  let n = 0;
  session.on('Page.screencastFrame', (frame) => {
    session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    page.request.post(endpoint + '/frame', { data: { n: ++n, ts: frame.metadata.timestamp, data: frame.data } }).catch(() => {});
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 1000 });
  page.__qaRec = session;
  return 'recording';
}
`;
  return `async (page) => {
  const endpoint = ${endpoint};
  const session = page.__qaRec;
  if (!session) return 'not recording';
  await page.waitForTimeout(1200);
  await session.send('Page.stopScreencast').catch(() => {});
  await session.detach().catch(() => {});
  delete page.__qaRec;
  await page.waitForTimeout(800);
  const response = await page.request.post(endpoint + '/stop', { timeout: 180000 });
  return await response.text();
}
`;
}

// ---------------------------------------------------------------------------------------------
// Transcript → actions

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n');

// Tool calls in the order the agent made them, each with its result. Streaming can log one
// message more than once, so calls are keyed by their id.
function toolCalls(file) {
  const calls = [];
  const byId = new Map();
  let prompt = null;
  for (const event of transcriptEvents(file)) {
    const content = event.message?.content;
    if (prompt === null && event.type === 'user') prompt = textOf(content);
    for (const part of Array.isArray(content) ? content : []) {
      if (part.type === 'tool_use' && !byId.has(part.id)) {
        const call = { name: part.name, input: part.input || {}, text: '', isError: false, done: false };
        byId.set(part.id, call);
        calls.push(call);
      } else if (part.type === 'tool_result' && byId.has(part.tool_use_id)) {
        const call = byId.get(part.tool_use_id);
        call.text = textOf(part.content);
        call.isError = Boolean(part.is_error) || /^### Error/m.test(call.text);
        call.done = true;
      }
    }
  }
  return { prompt: prompt || '', calls };
}

function parseLogin(prompt) {
  const match = LOGIN.exec(prompt);
  if (!match) return null;
  const password = match[2].includes('{{PASSWORD') ? null : match[2];
  return { user: match[1], password };
}

// The end index of the bracketed literal that starts at `start`, skipping brackets inside strings.
function closingBracket(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseCapture(source) {
  const file = /const file\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(source)?.[2];
  const at = source.search(/const marks\s*=\s*\[/);
  if (!file || at < 0) return null;
  const open = source.indexOf('[', at);
  const close = closingBracket(source, open);
  if (close < 0) return null;
  return { kind: 'capture', file: basename(file), marks: source.slice(open, close + 1) };
}

function snippetSource(filename) {
  if (!filename) return '';
  for (const path of [resolve(filename), resolve(PROJECT_ROOT, filename)])
    if (existsSync(path)) return readFileSync(path, 'utf8');
  return '';
}

function toAction(tool, call) {
  if (tool === 'browser_close') return null;
  if (tool === 'browser_run_code_unsafe') {
    const source = call.input.filename ? snippetSource(call.input.filename) : String(call.input.code || '');
    if (source.includes('Page.startScreencast')) return { kind: 'rec', action: 'start' };
    if (source.includes('Page.stopScreencast')) return { kind: 'rec', action: 'stop' };
    if (source.includes('/annotations/') && /const marks\s*=/.test(source)) return parseCapture(source);
  }
  if (tool === 'browser_take_screenshot' && call.input.filename)
    return { kind: 'capture', file: basename(String(call.input.filename)), marks: '[]' };
  const code = ranCode(call.text);
  return code ? { kind: 'code', tool: tool.replace(/^browser_/, ''), code } : null;
}

// What the agent did, split into the setup before its first case (the login) and one list of
// actions per case. Failed tool calls are dropped: a replay repeats what worked, not the retries.
export function extractActions(transcript, runId) {
  const { prompt, calls } = toolCalls(transcript);
  const setup = [];
  const cases = new Map();
  let current = null;
  for (const call of calls) {
    if (call.name === 'Bash') {
      const mark = MARK_RUNNING.exec(String(call.input.command || ''));
      if (mark && mark[1] === runId) {
        current = mark[2];
        if (!cases.has(current)) cases.set(current, []);
      }
      continue;
    }
    const tool = BROWSER_TOOL.exec(call.name)?.[1];
    if (!tool || !call.done || call.isError) continue;
    const action = toAction(tool, call);
    if (action) (current ? cases.get(current) : setup).push(action);
  }
  return { login: parseLogin(prompt), setup, cases };
}

// ---------------------------------------------------------------------------------------------
// Secrets: scripts hold {{user}} and {{secret}}; the runner fills them in memory at replay time.

const forms = (value) =>
  [...new Set([value, value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"), JSON.stringify(value).slice(1, -1), encodeURIComponent(value)])].filter(
    (form) => form.length >= 3,
  );

function redact(text, login) {
  let out = String(text);
  if (login?.password) for (const form of forms(login.password)) out = out.split(form).join('{{secret}}');
  if (login?.user) for (const form of forms(login.user)) out = out.split(form).join('{{user}}');
  return out.replace(PASSWORD_FILL, (match, head, quote, value) =>
    value.includes('{{') ? match : `${head}${quote}{{secret}}${quote}`,
  );
}

const redactAction = (action, login) =>
  action.kind === 'code'
    ? { ...action, code: redact(action.code, login) }
    : action.kind === 'capture'
      ? { ...action, marks: redact(action.marks, login) }
      : action;

export const jsEscape = (value) => String(value).replace(/[\\'"`]/g, '\\$&').replace(/\r?\n/g, '\\n').replace(/\$\{/g, '\\${');

export const fillSecrets = (text, { user, secret }) =>
  String(text)
    .split('{{user}}')
    .join(jsEscape(user ?? ''))
    .split('{{secret}}')
    .join(jsEscape(secret ?? ''));

export const needsSecret = (script) => JSON.stringify([script.setup, script.steps]).includes('{{secret}}');

// ---------------------------------------------------------------------------------------------
// Library I/O

const testFile = (planId, tcId) => safeJoin(TESTS_DIR, planId, `${tcId}.json`);

export function splitTestId(id) {
  const [planId, tcId, extra] = String(id || '').split('/');
  if (!planId || !tcId || extra !== undefined || !/^[A-Za-z0-9._-]+$/.test(planId + tcId))
    throw Object.assign(new Error(`invalid test id "${id}" (expected PLAN/TC)`), { status: 400 });
  return { planId, tcId };
}

export function readTest(id) {
  const { planId, tcId } = splitTestId(id);
  const test = readJson(testFile(planId, tcId));
  return test && !test.__parseError ? test : null;
}

export function listTests() {
  if (!existsSync(TESTS_DIR)) return [];
  const tests = [];
  for (const plan of readdirSync(TESTS_DIR, { withFileTypes: true })) {
    if (!plan.isDirectory() || plan.name.startsWith('.')) continue;
    for (const name of readdirSync(join(TESTS_DIR, plan.name)).filter((f) => f.endsWith('.json'))) {
      const test = readJson(join(TESTS_DIR, plan.name, name));
      if (test && !test.__parseError) tests.push(test);
    }
  }
  return tests.sort((a, b) => a.planId.localeCompare(b.planId) || (a.order ?? 0) - (b.order ?? 0) || a.tcId.localeCompare(b.tcId));
}

// Only tags and status are edited by people; everything else comes from a recording.
export function updateTest(id, patch) {
  const test = readTest(id);
  if (!test) throw Object.assign(new Error(`unknown test ${id}`), { status: 404 });
  if (patch.tags !== undefined) test.tags = cleanTags(patch.tags);
  if (patch.status !== undefined) {
    if (!TEST_STATUSES.includes(patch.status)) throw Object.assign(new Error(`status must be ${TEST_STATUSES.join(' or ')}`), { status: 400 });
    test.status = patch.status;
  }
  if (patch.lastReplay !== undefined) test.lastReplay = patch.lastReplay;
  writeJson(testFile(test.planId, test.tcId), test);
  return test;
}

export const cleanTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(',')).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30);

function saveScript(script) {
  const file = testFile(script.planId, script.tcId);
  const previous = readJson(file);
  if (previous && !previous.__parseError) {
    script.version = (previous.version || 1) + 1;
    script.tags = previous.tags || script.tags;
    const history = safeJoin(TESTS_DIR, script.planId, '.history');
    mkdirSync(history, { recursive: true });
    renameSync(file, join(history, `${script.tcId}.v${previous.version || 1}.json`));
  } else if (previous) rmSync(file);
  writeJson(file, script);
  return script;
}

// The test a run's case records into: replay and heal runs carry the original ids in `source`.
export const sourceOf = (plan, tc) => ({ planId: tc.source?.planId || plan.id, tcId: tc.source?.tcId || tc.id });

function buildScript(run, tc, actions, { setup, login, batch, predecessors }) {
  const { planId, tcId } = sourceOf(run.plan, tc);
  const result = tc.result || {};
  const stepOf = new Map();
  for (const step of result.steps || []) for (const file of step.evidence || []) if (!stepOf.has(file)) stepOf.set(file, Number(step.n));
  const reported = new Map((result.steps || []).map((s) => [Number(s.n), s]));
  const steps = tc.steps.map((s) => ({
    n: s.n,
    action: s.action,
    expected: s.expected || '',
    evidence: reported.get(Number(s.n))?.evidence || [],
    actions: [],
  }));
  const byN = new Map(steps.map((s) => [Number(s.n), s]));
  // Actions belong to the step whose evidence the next capture proves.
  let buffer = [];
  let current = Number(steps[0].n);
  for (const action of actions) {
    buffer.push(redactAction(action, login));
    const n = action.kind === 'capture' ? stepOf.get(action.file) : undefined;
    if (n === undefined || !byN.has(n)) continue;
    current = Math.max(current, n);
    byN.get(current).actions.push(...buffer);
    buffer = [];
  }
  steps.at(-1).actions.push(...buffer);
  steps.forEach((step, i) => {
    if (step.actions.length) return;
    const cover = steps.slice(i + 1).find((s) => s.actions.length) || steps.slice(0, i).reverse().find((s) => s.actions.length);
    if (cover) step.coveredBy = cover.n;
  });

  // A mark the agent's own capture could not find stays optional in replay.
  const evidenceDir = join(tcDir(run.id, tc.id), 'evidence');
  for (const step of steps)
    for (const action of step.actions)
      if (action.kind === 'capture') {
        const sidecar = readJson(join(evidenceDir, `${action.file}.annotations.json`), {});
        const missing = (sidecar.items || []).filter((i) => /^Not found: /.test(i.text || '')).map((i) => i.text.slice(11));
        if (missing.length) action.optional = missing;
      }

  const targets = { ...(run.plan.environment?.targets || {}), ...(tc.environment?.targets || {}) };
  const account = batch?.account?.user
    ? { user: batch.account.user, ...(batch.account.secret && { secret: batch.account.secret }) }
    : login?.user || run.plan.environment?.user
      ? { user: login?.user || run.plan.environment.user }
      : null;
  return {
    schemaVersion: 1,
    id: `${planId}/${tcId}`,
    planId,
    tcId,
    title: tc.title,
    tags: cleanTags(tc.tags || []),
    group: tc.source?.group ?? tc.group ?? null,
    order: tc.source?.order ?? run.plan.testCases.findIndex((t) => t.id === tc.id),
    variants: tc.variants || {},
    target: { app: targets.app || null },
    account,
    ...(tc.preconditions?.length && { preconditions: tc.preconditions }),
    ...(tc.data && { data: tc.data }),
    setup: setup.map((a) => redactAction(a, login)),
    recordedAfter: predecessors,
    steps,
    expected: tc.expected,
    record: steps.some((s) => s.actions.some((a) => a.kind === 'rec')),
    status: 'draft',
    version: 1,
    recordedFrom: {
      runId: run.id,
      tcId: tc.id,
      model: tc.executedBy?.model || batch?.model || null,
      at: new Date().toISOString(),
    },
  };
}

// Called right after a batch's usage is recorded. Returns one line per case for the orchestrator.
export function extractScripts(run, batchCases, transcript, batch = null) {
  const lines = [];
  let extracted;
  try {
    extracted = extractActions(transcript, run.id);
  } catch (error) {
    return [`script: transcript not readable (${error.message})`];
  }
  const { setup, cases, login } = extracted;
  batchCases.forEach((id, index) => {
    const tc = run.testCases.find((t) => t.id === id);
    if (!tc) return;
    const tool = tc.tool || run.plan.defaults?.tool || 'playwright-mcp';
    const why =
      tc.status !== 'pass'
        ? `not saved (${tc.status})`
        : tc.warnings.length
          ? `not saved (${tc.warnings.length} contract warning(s))`
          : tool !== 'playwright-mcp'
            ? `not saved (tool ${tool})`
            : !cases.get(id)?.length
              ? 'not saved (no browser actions found in the transcript)'
              : null;
    if (why) return lines.push(`script ${id}: ${why}`);
    const script = buildScript(run, tc, cases.get(id), {
      setup,
      login,
      batch,
      predecessors: setup.length ? [] : batchCases.slice(0, index).map((p) => sourceOf(run.plan, run.testCases.find((t) => t.id === p) || { id: p }).tcId),
    });
    const serialized = JSON.stringify(script);
    if (login?.password && forms(login.password).some((form) => serialized.includes(form)))
      return lines.push(`script ${id}: not saved (the password could not be redacted)`);
    const saved = saveScript(script);
    const actions = saved.steps.reduce((sum, s) => sum + s.actions.length, 0);
    lines.push(
      `script saved: ${saved.id} v${saved.version} (draft, ${saved.steps.length} steps, ${actions} actions${saved.setup.length ? `, setup ${saved.setup.length}` : ''}) → ${displayPath(testFile(saved.planId, saved.tcId))}`,
    );
  });
  return lines;
}

// A reviewer's verdict on the run a script was recorded from decides whether it is trusted.
export function reviewRecorded(run, tcId, verdict) {
  const tc = run.plan.testCases?.find((t) => t.id === tcId);
  if (!tc) return null;
  const { planId, tcId: sourceTc } = sourceOf(run.plan, tc);
  const test = readTest(`${planId}/${sourceTc}`);
  if (!test || test.recordedFrom?.runId !== run.id) return null;
  return updateTest(test.id, { status: verdict === 'approved' ? 'verified' : 'draft' });
}

// ---------------------------------------------------------------------------------------------
// Suites ("Test plans" in the viewer)

const suiteFile = (id) => safeJoin(SUITES_DIR, `${id}.json`);

export const slugify = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
    .toLowerCase() || 'test-plan';

export function listSuites() {
  if (!existsSync(SUITES_DIR)) return [];
  return readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(SUITES_DIR, f)))
    .filter((s) => s && !s.__parseError)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function readSuite(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id || ''))) return null;
  const suite = readJson(suiteFile(id));
  return suite && !suite.__parseError ? suite : null;
}

export function saveSuite(input, { create = false } = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('a test plan needs a name'), { status: 400 });
  const tests = [...new Set((input.tests || []).map(String))];
  for (const id of tests) splitTestId(id);
  let id = input.id;
  const now = new Date().toISOString();
  if (create) {
    const base = slugify(name);
    id = base;
    for (let i = 2; existsSync(suiteFile(id)); i += 1) id = `${base}-${i}`;
  } else if (!readSuite(id)) throw Object.assign(new Error(`unknown test plan ${id}`), { status: 404 });
  const previous = create ? null : readSuite(id);
  const suite = {
    schemaVersion: 1,
    id,
    name,
    description: String(input.description ?? previous?.description ?? '').slice(0, 2000),
    tags: cleanTags(input.tags ?? previous?.tags ?? []),
    tests,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  writeJson(suiteFile(id), suite);
  return suite;
}

export function deleteSuite(id) {
  if (!readSuite(id)) throw Object.assign(new Error(`unknown test plan ${id}`), { status: 404 });
  rmSync(suiteFile(id));
}
