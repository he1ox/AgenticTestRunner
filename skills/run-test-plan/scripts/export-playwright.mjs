// Export: library scripts (.qa/tests/<plan>/<tc>.json) → standard Playwright Test files, so a team
// can run them with a stock `npx playwright test` and own them as code. The replay engine stays
// the source of truth for qa-runner's own runs; the export is a one-way translation.
//
// One file per script (<out>/<planId>/<tcId>.spec.ts): it maps one to one onto the library, so a
// selection writes exactly those files and a re-recorded script shows up as a diff of one file.
// Cases of one plan group were recorded and replay in ONE browser session, in order, and may
// lean on each other's state, so a group of two or more scripts becomes one file
// (<out>/<planId>/group-<group>.spec.ts) whose tests run serially on a shared page.
//
// Translation rules (anything not translated is a `// TODO(qa-runner): …` comment, never dropped):
// - setup (the recorded login) → test.beforeEach (test.beforeAll for a group), as a test.step;
//   {{user}} → the account user, {{secret}} → process.env.<NAME> from the account's env:NAME secret
//   (QA_PASSWORD otherwise). A secret is never written to the file.
// - every plan step → a test.step titled "<n>. <action>", its expected result as a comment.
// - recorded Playwright code → as is (it is already Playwright code); a page.goto to the target
//   app's URL goes through BASE_URL (QA_BASE_URL overrides it).
// - an annotated capture → one `expect(locator.first()).toBeVisible()` per mark (the marks are
//   what replay asserts) and the screenshot attached to the report; a capture without marks
//   attaches the screenshot and leaves a TODO quoting the step's expected result.
// - recordings → a note pointing at Playwright's own `use.video`.
//
// Output is deterministic (no dates, stable order), so the same scripts give byte-identical
// files and an existing file that differs is only replaced with --force.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execution } from './schedule.mjs';
import { listTests, readSuite, readTest, slugify } from './tests.mjs';
import { CONFIG, PROJECT_ROOT, TESTS_DIR, displayPath } from './lib.mjs';

export const DEFAULT_OUT = 'e2e/qa';
const CONFIG_FILES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs', 'playwright.config.mts', 'playwright.config.cts'];
const PLACEHOLDER = /\{\{(user|secret)\}\}/;
const VARS = { user: 'USER', secret: 'PASSWORD' };

// ---------------------------------------------------------------------------------------------
// Selection

const groupKey = (t) => `${t.planId}.${t.group || t.tcId}`;

// The union of the selectors (no selector = the whole library), widened to whole groups: a
// group's file always holds all of its scripts, whichever one was asked for.
export function selectTests({ ids = [], tag, suite, plan } = {}) {
  const all = listTests();
  const notes = [];
  const picked = new Set();
  if (!ids.length && !tag && !suite && !plan) all.forEach((t) => picked.add(t.id));
  for (const id of ids) {
    if (!readTest(id)) throw Object.assign(new Error(`unknown test ${id}`), { status: 404 });
    picked.add(id);
  }
  if (tag) {
    const tagged = all.filter((t) => (t.tags || []).includes(String(tag).toLowerCase()));
    if (!tagged.length) notes.push(`no test is tagged "${tag}".`);
    tagged.forEach((t) => picked.add(t.id));
  }
  if (plan) {
    const inPlan = all.filter((t) => t.planId === plan);
    if (!inPlan.length) throw Object.assign(new Error(`no tests of plan ${plan} in the library`), { status: 404 });
    inPlan.forEach((t) => picked.add(t.id));
  }
  if (suite) {
    const s = readSuite(suite);
    if (!s) throw Object.assign(new Error(`unknown test plan ${suite}`), { status: 404 });
    for (const id of s.tests) {
      if (readTest(id)) picked.add(id);
      else notes.push(`${id} (in test plan ${suite}) is not in the library any more; skipped.`);
    }
  }
  const groups = new Set(all.filter((t) => picked.has(t.id) && t.group).map(groupKey));
  for (const t of all)
    if (!picked.has(t.id) && t.group && groups.has(groupKey(t))) {
      picked.add(t.id);
      notes.push(`${t.id} added: it shares group "${t.group}" with a selected test, and a group exports as one file.`);
    }
  return { tests: all.filter((t) => picked.has(t.id)), notes };
}

// Scripts → files: { file (relative to out), tests[] }, in library order.
export function planFiles(tests) {
  const byGroup = new Map();
  for (const t of tests) {
    const key = groupKey(t);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(t);
  }
  return [...byGroup.values()].map((group) => ({
    file: group.length > 1 ? `${group[0].planId}/group-${slugify(group[0].group)}.spec.ts` : `${group[0].planId}/${group[0].tcId}.spec.ts`,
    tests: group,
  }));
}

// ---------------------------------------------------------------------------------------------
// Rendering helpers

const lit = (value) =>
  `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const comment = (text) => `// ${oneLine(text)}`;
const todo = (text) => `// TODO(qa-runner): ${oneLine(text)}`;
const commentedOut = (code) => code.split('\n').map((line) => `//   ${line}`.trimEnd());

// A value that may hold {{user}} / {{secret}} → a TS expression using USER / PASSWORD.
function valueExpr(value, ctx) {
  const parts = String(value).split(/\{\{(user|secret)\}\}/);
  if (parts.length === 1) return lit(value);
  const exprs = parts
    .map((part, i) => {
      if (i % 2 === 0) return part ? lit(part) : null;
      ctx.used.add(part);
      return VARS[part];
    })
    .filter(Boolean);
  return exprs.join(' + ');
}

// The same inside recorded code: placeholders only ever sit in string literals there.
function fillCode(code, ctx) {
  if (!PLACEHOLDER.test(code)) return code;
  let out = '';
  for (let i = 0; i < code.length; ) {
    const ch = code[i];
    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const j = end < 0 ? code.length : end;
      out += code.slice(i, j);
      i = j;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === '\\' ? 2 : 1;
      const body = code.slice(i + 1, j);
      if (!PLACEHOLDER.test(body)) out += ch + body + ch;
      else if (ch === '`')
        out += `\`${body.replace(/\{\{(user|secret)\}\}/g, (m, name) => (ctx.used.add(name), `\${${VARS[name]}}`))}\``;
      else {
        const parts = body.split(/\{\{(user|secret)\}\}/);
        out += parts
          .map((part, k) => {
            if (k % 2 === 0) return part ? ch + part + ch : null;
            ctx.used.add(part);
            return VARS[part];
          })
          .filter(Boolean)
          .join(' + ');
      }
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const appBase = (app) => (/^https?:\/\/[^\s'"`]+$/.test(String(app || '')) ? String(app).replace(/\/+$/, '') : null);

// page.goto('<target app>/path') → page.goto(BASE_URL + '/path'), so one spec runs against any
// environment of the same app.
function rebaseGoto(code, ctx) {
  if (!ctx.base) return code;
  return code.replace(/page\.goto\((['"])((?:\\.|(?!\1).)*)\1/g, (match, quote, url) => {
    if (!url.startsWith(ctx.base)) return match;
    const rest = url.slice(ctx.base.length);
    if (rest && !/^[/?#]/.test(rest)) return match;
    ctx.usesBase = true;
    return `page.goto(${rest ? `BASE_URL + ${quote}${rest}${quote}` : 'BASE_URL'}`;
  });
}

// The bracketed literal starting at `start` (skipping brackets inside strings).
function bracketed(source, start) {
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
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

// A JavaScript literal made only of data (arrays, objects, strings, numbers, true/false/null),
// read without running it: exporting a script from an unreviewed pull request runs nothing.
// Anything else (a call, a variable, a template with ${}) throws.
export function parseLiteral(source) {
  let i = 0;
  const fail = () => {
    throw new Error(`not a plain literal at ${i}`);
  };
  const space = () => {
    for (;;) {
      if (/\s/.test(source[i] || '')) i += 1;
      else if (source.startsWith('//', i)) i = source.includes('\n', i) ? source.indexOf('\n', i) : source.length;
      else if (source.startsWith('/*', i)) i = source.indexOf('*/', i) < 0 ? fail() : source.indexOf('*/', i) + 2;
      else return;
    }
  };
  const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
  const string = () => {
    const quote = source[i++];
    let out = '';
    while (i < source.length && source[i] !== quote) {
      if (quote === '`' && source.startsWith('${', i)) fail();
      if (source[i] === '\\') {
        const next = source[i + 1];
        if (next === 'u' || next === 'x') {
          const hex = next === 'x' ? source.slice(i + 2, i + 4) : source[i + 2] === '{' ? source.slice(i + 3, source.indexOf('}', i)) : source.slice(i + 2, i + 6);
          if (!/^[0-9a-f]+$/i.test(hex)) fail();
          out += String.fromCodePoint(parseInt(hex, 16));
          i += next === 'x' ? 4 : source[i + 2] === '{' ? hex.length + 4 : 6;
          continue;
        }
        out += next === '\n' ? '' : ESCAPES[next] ?? next;
        i += 2;
      } else out += source[i++];
    }
    if (source[i] !== quote) fail();
    i += 1;
    return out;
  };
  const value = () => {
    space();
    const ch = source[i];
    if (ch === '[') {
      i += 1;
      const list = [];
      for (space(); source[i] !== ']'; space()) {
        list.push(value());
        space();
        if (source[i] === ',') i += 1;
        else if (source[i] !== ']') fail();
      }
      i += 1;
      return list;
    }
    if (ch === '{') {
      i += 1;
      const object = {};
      for (space(); source[i] !== '}'; space()) {
        let key;
        if (source[i] === "'" || source[i] === '"') key = string();
        else {
          key = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))?.[0] ?? fail();
          i += key.length;
        }
        space();
        if (source[i++] !== ':') fail();
        Object.defineProperty(object, key, { value: value(), enumerable: true, writable: true, configurable: true });
        space();
        if (source[i] === ',') i += 1;
        else if (source[i] !== '}') fail();
      }
      i += 1;
      return object;
    }
    if (ch === "'" || ch === '"' || ch === '`') return string();
    const word = /^(?:true|false|null|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?![\w$])/i.exec(source.slice(i))?.[0] ?? fail();
    i += word.length;
    return word === 'true' ? true : word === 'false' ? false : word === 'null' ? null : Number(word);
  };
  const result = value();
  space();
  if (i !== source.length) fail();
  return result;
}

// Marks are stored as JavaScript source (an array literal the agent wrote); anything that is not
// plain data is reported in a TODO, never run.
function parseMarks(source) {
  try {
    const value = parseLiteral(source);
    if (!Array.isArray(value)) return null;
    return value.map((m) => ({
      selector: typeof m?.selector === 'string' ? m.selector : null,
      label: typeof (m?.label ?? m?.name) === 'string' ? m.label ?? m.name : null,
    }));
  } catch {
    return null;
  }
}

// text=Foo → getByText('Foo'), text="Foo" → getByText('Foo', { exact: true }) (the same matching
// rules); any other selector stays a page.locator(). Always .first(), like the replay.
function locatorExpr(selector, ctx) {
  const text = /^text=([\s\S]+)$/.exec(selector);
  if (text && !text[1].startsWith('/')) {
    const quoted = /^(["'])([\s\S]*)\1$/.exec(text[1]);
    return quoted
      ? `page.getByText(${valueExpr(quoted[2], ctx)}, { exact: true }).first()`
      : `page.getByText(${valueExpr(text[1], ctx)}).first()`;
  }
  return `page.locator(${valueExpr(selector, ctx)}).first()`;
}

// Quoted text in an expected result ("Inline error 'Email is required'") → a suggested
// assertion, left in the TODO for a person to accept: free text is not a contract.
function quotedTexts(expected) {
  const found = [];
  const re = /(?:^|[\s(:])(["'“‘])([^"'“”‘’\n]{2,80})(["'”’])(?=$|[\s).,;:!?])/g;
  for (let m; (m = re.exec(String(expected || ''))); ) found.push(m[2]);
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------------------------
// Actions → lines

function codeAction(action, ctx) {
  let code = String(action.code || '').trim();
  if (!code) return [todo(`empty ${action.tool || 'code'} action in the script.`)];
  if (/^\/\/\s*<internal code/m.test(code))
    return [todo(`Playwright MCP's "${action.tool}" ran internal code it does not show; redo this action in Playwright.`), ...commentedOut(code)];
  if (/\bfileChooser\b/.test(code))
    return [
      todo('file upload: Playwright MCP answered a file chooser that this test never opens; use locator.setInputFiles() or page.waitForEvent(\'filechooser\').'),
      ...commentedOut(code),
    ];
  code = rebaseGoto(fillCode(code, ctx), ctx);
  if (PLACEHOLDER.test(code)) return [todo('a {{user}}/{{secret}} placeholder outside a string literal could not be translated.'), ...commentedOut(code)];
  // browser_run_code_unsafe answers with its function applied to the page; type its parameter.
  if (/\(async \(page\) =>/.test(code)) {
    ctx.usesPageType = true;
    code = code.replace(/\(async \(page\) =>/g, '(async (page: Page) =>');
  }
  ctx.actions += 1;
  return code.split('\n');
}

function captureAction(action, step, ctx) {
  const lines = [];
  let marksSource = action.marks;
  if (action.code) {
    const at = action.code.search(/const marks\s*=\s*\[/);
    marksSource = at < 0 ? null : bracketed(action.code, action.code.indexOf('[', at));
    lines.push(todo(`${action.file} was taken by the agent's own capture code; only its marks are translated below.`));
  }
  const marks = marksSource == null ? [] : parseMarks(marksSource);
  if (marks === null) {
    lines.push(todo(`the marks of ${action.file} are not plain data and were not translated:`), ...commentedOut(marksSource));
  } else {
    const optional = new Set(action.optional || []);
    for (const mark of marks) {
      if (!mark.selector) {
        lines.push(todo(`a mark of ${action.file} has no selector${mark.label ? ` ("${mark.label}")` : ''}; nothing to assert.`));
        continue;
      }
      if (optional.has(mark.selector)) {
        lines.push(comment(`NOTE(qa-runner): ${mark.selector} was not on the page when the case was recorded either; not asserted.`));
        continue;
      }
      const message = mark.label ? `, ${valueExpr(mark.label, ctx)}` : '';
      lines.push(`await expect(${locatorExpr(mark.selector, ctx)}${message}).toBeVisible();`);
      ctx.assertions += 1;
    }
    if (!marks.length) {
      const expected = oneLine(step?.expected);
      lines.push(todo(`${action.file} was captured without marks, so nothing is asserted here.${expected ? ` Expected: ${expected}` : ''}`));
      for (const text of quotedTexts(expected)) lines.push(`//   e.g. await expect(${locatorExpr(`text=${text}`, ctx)}).toBeVisible();`);
    }
  }
  lines.push(`await test.info().attach(${lit(action.file)}, { body: await page.screenshot(), contentType: 'image/png' });`);
  return lines;
}

function actionLines(action, step, ctx) {
  if (action.kind === 'code') return codeAction(action, ctx);
  if (action.kind === 'capture') return captureAction(action, step, ctx);
  if (action.kind === 'rec')
    return [
      comment(
        action.action === 'start'
          ? 'NOTE(qa-runner): the case was recorded on video from here; in Playwright set use.video in playwright.config.ts.'
          : 'NOTE(qa-runner): the video recording stopped here.',
      ),
    ];
  return [todo(`unknown action kind "${action.kind}" in the script.`)];
}

const indent = (lines, level) => lines.map((line) => (line ? '  '.repeat(level) + line : line));

function setupBlock(test, ctx, fixture) {
  const lines = [];
  if (ctx.needsSecret) lines.push(`if (!PASSWORD) throw new Error(${lit(`Set ${ctx.env}: the recorded steps type a password.`)});`);
  if (test?.setup?.length) {
    lines.push(`await test.step('Setup (recorded login)', async () => {`);
    for (const action of test.setup) lines.push(...indent(actionLines(action, null, ctx), 1));
    lines.push('});');
  }
  if (!lines.length) return [];
  if (fixture === 'browser') return ['test.beforeAll(async ({ browser }) => {', ...indent(['page = await browser.newPage();', ...lines], 1), '});'];
  return [`test.beforeEach(async (${test?.setup?.length ? '{ page }' : ''}) => {`, ...indent(lines, 1), '});'];
}

function testBlock(test, ctx, { shared }) {
  const tags = (test.tags || []).map((t) => `@${t.replace(/\s+/g, '-')}`);
  const details = tags.length ? `{ tag: [${tags.map(lit).join(', ')}] }, ` : '';
  const body = [];
  if (test.status !== 'verified') body.push(comment('NOTE(qa-runner): a draft script: no reviewer has approved the run it was recorded from yet.'));
  for (const p of test.preconditions || []) body.push(comment(`Precondition: ${p}`));
  const variants = Object.entries(test.variants || {});
  if (variants.length) body.push(comment(`Variants: ${variants.map(([k, v]) => `${k}=${v}`).join(', ')} (set the matching project or test.use options).`));
  if (test.recordedAfter?.length && !shared)
    body.push(comment(`NOTE(qa-runner): recorded right after ${test.recordedAfter.join(', ')} in the same browser session with no login of its own; it may depend on what that left behind.`));
  if (test.expected) body.push(comment(`Expected: ${test.expected}`));
  for (const step of test.steps) {
    const title = `${step.n}. ${oneLine(step.action)}`;
    if (!step.actions.length) {
      if (step.coveredBy !== undefined) body.push(comment(`Step ${title} — recorded together with step ${step.coveredBy}.`));
      else body.push(todo(`step ${title} has no recorded actions; nothing checks it.`));
      continue;
    }
    body.push(`await test.step(${lit(title)}, async () => {`);
    if (step.expected) body.push(`  ${comment(`Expected: ${step.expected}`)}`);
    for (const action of step.actions) body.push(...indent(actionLines(action, step, ctx), 1));
    body.push('});');
  }
  return [`test(${lit(`${test.tcId} ${oneLine(test.title)}`)}, ${details}async (${shared ? '' : '{ page }'}) => {`, ...indent(body, 1), '});'];
}

// The environment variable the replay would read the password from (replay.mjs credentials()).
function secretEnv(test) {
  const user = test.account?.user ?? null;
  const ref = test.account?.secret || execution().accounts.find((a) => a.user === user)?.secret || null;
  return ref?.startsWith('env:') ? ref.slice(4) : 'QA_PASSWORD';
}

// One spec file's text. `command` is the regeneration command written in the header.
export function renderSpec(tests, { command }) {
  const first = tests[0];
  const shared = tests.length > 1;
  const setupFrom = tests.find((t) => t.setup?.length) || null;
  const ctx = {
    used: new Set(),
    base: appBase(first.target?.app),
    usesBase: false,
    usesPageType: shared,
    needsSecret: false,
    env: secretEnv(setupFrom || first),
    actions: 0,
    assertions: 0,
  };
  ctx.needsSecret = tests.some((t) => JSON.stringify([shared ? setupFrom?.setup : t.setup, t.steps]).includes('{{secret}}'));

  // Body first: it decides which constants and imports the file needs.
  const body = [];
  if (shared) {
    body.push(
      comment(`These cases form group "${first.group}" of plan ${first.planId}: they were recorded, and replay, in one browser session in this`),
      comment('order, so they share one page and run serially. Give each case its own login to split them.'),
      "test.describe.configure({ mode: 'serial' });",
      '',
      'let page: Page;',
      '',
    );
    const setup = setupBlock(setupFrom, ctx, 'browser');
    body.push(...(setup.length ? setup : ['test.beforeAll(async ({ browser }) => {', '  page = await browser.newPage();', '});']), '');
    body.push('test.afterAll(async () => {', '  await page.close();', '});', '');
  } else {
    const setup = setupBlock(first, ctx, 'page');
    if (setup.length) body.push(...setup, '');
  }
  tests.forEach((t, i) => {
    if (i) body.push('');
    body.push(...testBlock(t, ctx, { shared }));
  });
  const todos = body.filter((line) => /^\s*\/\/ TODO\(qa-runner\)/.test(line)).length;

  const header = [];
  for (const t of tests) {
    header.push(
      comment(`Generated by qa-runner from ${displayPath(join(TESTS_DIR, t.planId, `${t.tcId}.json`))}: script ${t.id} v${t.version} (${t.status}).`),
      comment(`Plan ${t.planId}, case ${t.tcId}: ${t.title}${t.recordedFrom?.runId ? ` (recorded in run ${t.recordedFrom.runId})` : ''}.`),
    );
  }
  header.push(
    comment(`Regenerate: qa-runs.mjs ${command} (a changed file is only replaced with --force).`),
    comment(
      todos
        ? `${todos} TODO(qa-runner) comment(s) mark what could not be turned into code or assertions.`
        : 'Every recorded action and mark is translated; screenshots are attached to the report.',
    ),
    '',
    `import { test, expect${ctx.usesPageType ? ', type Page' : ''} } from '@playwright/test';`,
  );
  const consts = [];
  if (ctx.usesBase) consts.push(`const BASE_URL = process.env.QA_BASE_URL ?? ${lit(ctx.base)};`);
  if (ctx.used.has('user')) consts.push(`const USER = ${lit((setupFrom || first).account?.user ?? '')};`);
  if (ctx.used.has('secret') || ctx.needsSecret) consts.push(`const PASSWORD = process.env.${ctx.env} ?? ''; // never written to this file`);
  const text = [...header, '', ...(consts.length ? [...consts, ''] : []), ...body].join('\n');
  return { text: `${text.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, actions: ctx.actions, assertions: ctx.assertions, todos };
}

// ---------------------------------------------------------------------------------------------
// Files

function writeIfAllowed(file, text, force) {
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (current === text) return 'unchanged';
    if (!force) return 'exists';
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return 'written';
}

function configText(out) {
  const ex = CONFIG.execution || {};
  const actionTimeout = Math.max(1000, Number(ex.replayTimeoutMs) || 15000);
  const navigationTimeout = Math.max(5000, Number(ex.replayNavigationTimeoutMs) || 60000);
  let testDir = relative(PROJECT_ROOT, out).split('\\').join('/');
  if (!testDir.startsWith('.')) testDir = `./${testDir}`;
  return `// Generated by qa-runner (qa-runs.mjs export --config) for the specs in ${testDir}. Yours to edit.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: ${lit(testDir)},
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The waits the qa-runner replay uses (execution.replayTimeoutMs / replayNavigationTimeoutMs).
    actionTimeout: ${actionTimeout},
    navigationTimeout: ${navigationTimeout},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
`;
}

// The whole command: select, render, write. Returns lines to print.
export function exportPlaywright({ ids = [], tag, suite, plan, out = DEFAULT_OUT, force = false, config = false } = {}) {
  const { tests, notes } = selectTests({ ids, tag, suite, plan });
  const outDir = resolve(PROJECT_ROOT, out);
  const outShown = displayPath(outDir);
  const lines = notes.map((n) => `! ${n}`);
  if (!tests.length) {
    lines.push('no tests to export: scripts are saved when an agent passes a case.');
    return { lines, files: [] };
  }
  const files = [];
  for (const { file, tests: group } of planFiles(tests)) {
    const command = `export ${group[0].id}${outShown === DEFAULT_OUT ? '' : ` --out ${outShown}`}`;
    const spec = renderSpec(group, { command });
    const path = join(outDir, file);
    const state = writeIfAllowed(path, spec.text, force);
    files.push({ file: displayPath(path), state, ...spec, tests: group.map((t) => t.id) });
    const counts = `${spec.actions} actions, ${spec.assertions} assertions${spec.todos ? `, ${spec.todos} TODO` : ''}`;
    lines.push(
      state === 'exists'
        ? `SKIP ${displayPath(path)}: it exists and differs (edited by hand?); --force replaces it.`
        : `${state === 'written' ? 'OK  ' : 'SAME'} ${displayPath(path)}  (${group.map((t) => t.id).join(', ')}; ${counts})`,
    );
  }
  if (config) {
    const existing = CONFIG_FILES.find((f) => existsSync(join(PROJECT_ROOT, f)));
    if (existing && !force) lines.push(`SKIP ${existing}: a Playwright config exists; point its testDir at ${outShown} (or --force replaces playwright.config.ts).`);
    else {
      const state = writeIfAllowed(join(PROJECT_ROOT, 'playwright.config.ts'), configText(outDir), true);
      lines.push(`${state === 'written' ? 'OK  ' : 'SAME'} playwright.config.ts`);
    }
  }
  const todos = files.reduce((sum, f) => sum + f.todos, 0);
  lines.push(
    `${files.filter((f) => f.state === 'written').length} written, ${files.filter((f) => f.state === 'unchanged').length} unchanged, ${files.filter((f) => f.state === 'exists').length} skipped` +
      (todos ? `; ${todos} TODO(qa-runner) to finish by hand.` : '.'),
    'Run them with `npx playwright test` (needs @playwright/test in this project: npm i -D @playwright/test && npx playwright install).',
  );
  return { lines, files };
}
