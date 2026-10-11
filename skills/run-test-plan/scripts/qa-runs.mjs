#!/usr/bin/env node
// run-test-plan CLI. One entry point for the orchestrator and the Test Agents:
//
//   init <plan.json> [--label txt] [--record] [--only TC-1,TC-2] [--retest <runId>]
//        Freeze the plan into a new run folder, write one brief per test case, and schedule
//        batches (tier, model, effort) in schedule.json.
//   open [runId]              Start the viewer server if needed and open it in the browser.
//   serve                     Run the viewer server in the foreground.
//   mark <runId> <tcId> <running|pending> [note]
//                             Live progress the viewer shows before result.json exists.
//   validate <runId>          Check every result against the contract; writes run.json.
//   status <runId>            One line per test case (cheap for the orchestrator's context).
//   latest                    Print the newest run id.
//   annotate <runId> <tcId> <image> [--list] [--add '<json>'] [--replace] [--remove <ids|all>]
//            [--author agent|chat|reviewer] [--summary txt]
//                             Read or change a screenshot's annotations (arrows, boxes, text…).
//   ask <runId> <tcId> --field txt [--context txt] [--screenshot file] [--timeout 300]
//                             Ask the human for a missing input and wait for the answer.
//   answer <runId> <tcId> <qid> <value> [--sensitive] [--remember project|user]
//   questions [runId]         Open questions, for answering from the terminal.
//   memory <list|show|recall|add|used|approve|stale|reject|prune> …   (memory --help)
//   next <runId> [--release <batch>] [--fallback]
//                             The batches to launch now (agent, model, effort, prompt), after
//                             escalating cheap-model verdicts that need a second look.
//   usage <runId> --batch B (--transcript <agent output file> | --tokens N [--model sonnet])
//         [--tool-uses N] [--ms N]   (--group G instead of --batch for runs without a schedule)
//                             Record what a batch cost and mark it done; no source = summary
//                             (--profile: where the run's tokens went, by tool).
//   profile <transcript.jsonl…>  Where agents' tokens went, by tool, from transcripts.
//
// Test library and deterministic runs (references/library.md):
//   tests [list [--tag t] | show <id> | tag <id> <a,b> | verify <id> | draft <id>]
//                             Scripts saved from passing cases, by id PLAN/TC.
//   suite list | show <id> | create <name> [--tags a,b] [--tests ids] [--tag t]
//         | add|remove <id> <testIds…> [--tag t] | delete <id>
//                             Test plans (suites): a name, tags and library tests.
//   suite run <id> [--headed] [--label txt]
//                             Replay every test of a suite without an agent (no tokens).
//   replay <runId>            Execute a run the viewer prepared (spawned by the server).
//   heal <runId> <tcId>       New agent run of one failed replay case; its script replaces the old.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { imageSize, readAnnotations, removeAnnotations, writeAnnotations } from './annotations.mjs';
import {
  BRIEF_LIMIT,
  KINDS,
  addMemory,
  caseQuery,
  findMemory,
  loadMemories,
  pointer,
  prune,
  rank,
  recordUse,
  removeMemory,
  scanMemories,
  updateMemory,
} from './memory.mjs';
import { answerQuestion, askQuestion, openQuestions, readQuestions, waitForAnswer } from './questions.mjs';
import { PRICING_AS_OF, costOf } from './pricing.mjs';
import { buildSchedule, escalate, execution, finishBatch, nextLaunch, readSchedule, saveSchedule } from './schedule.mjs';
import { executeRun, prepareSuiteRun } from './replay.mjs';
import { mergeProfiles, parseTranscript, recordUsage, runCost } from './usage.mjs';
import {
  captureCode,
  cleanTags,
  deleteSuite,
  extractScripts,
  listSuites,
  listTests,
  readSuite,
  readTest,
  recordingCode,
  saveSuite,
  updateTest,
} from './tests.mjs';
import {
  CONFIG,
  PORT,
  PROJECT_ROOT,
  SKILL_DIR,
  countStatuses,
  displayPath,
  ensureServer,
  listRuns,
  loadRun,
  readJson,
  runDir,
  stamp,
  tcDir,
  writeJson,
} from './lib.mjs';

const argv = process.argv.slice(2);
if (argv[0] === '--project') argv.splice(0, 2);
const [command, ...rest] = argv;
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    flags[key] = next && !next.startsWith('--') ? ((i += 1), next) : true;
  } else args.push(rest[i]);
}

const repoPath = displayPath;
const fail = (message) => {
  console.error(`ERROR ${message}`);
  process.exit(1);
};

async function init(planArg = args[0], opts = flags) {
  const planFile = planArg && resolve(planArg);
  if (!planFile || !existsSync(planFile)) fail('init needs an existing plan file.');
  const plan = readJson(planFile);
  if (!plan || plan.__parseError) fail(`plan is not valid JSON: ${plan?.__parseError}`);
  const problems = checkPlan(plan);
  if (problems.length) fail(`plan has problems:\n- ${problems.join('\n- ')}`);

  let selected = plan.testCases;
  if (opts.only) {
    const only = new Set(String(opts.only).split(','));
    selected = selected.filter((tc) => only.has(tc.id));
  }
  const carried = new Map();
  if (opts.retest) {
    const previous = loadRun(opts.retest);
    for (const tc of previous.testCases) {
      const answered = (tc.questions || []).filter((q) => q.answeredAt);
      if (answered.length) carried.set(tc.id, answered);
    }
    const redo = new Set(
      previous.testCases
        .filter(
          (tc) =>
            ['fail', 'blocked', 'pending', 'running'].includes(tc.status) ||
            ['rejected', 'needs-retest'].includes(tc.review?.verdict),
        )
        .map((tc) => tc.id),
    );
    selected = selected.filter((tc) => redo.has(tc.id));
  }
  if (!selected.length) fail('no test case left to run after filtering.');

  const runId = `${plan.id}_${stamp()}`;
  const dir = runDir(runId);
  if (existsSync(dir)) fail(`run ${runId} already exists; run init again.`);
  mkdirSync(dir, { recursive: true });
  const frozen = { ...plan, testCases: selected };
  writeJson(join(dir, 'plan.json'), frozen);
  writeJson(join(dir, 'meta.json'), {
    createdAt: new Date().toISOString(),
    label: opts.label || null,
    planFile: repoPath(planFile),
    recordAll: Boolean(opts.record),
    retestOf: opts.retest || null,
    ...(opts.heal && { healOf: opts.heal }),
  });
  writeJson(join(dir, 'review.json'), {});

  const briefed = [];
  for (const tc of selected) {
    const base = tcDir(runId, tc.id);
    mkdirSync(join(base, 'evidence'), { recursive: true });
    const record = Boolean(opts.record || tc.record || plan.defaults?.record);
    if (record) writeRecordingSnippets(runId, tc.id);
    writeCaptureSnippet(runId, tc.id);
    const memories = rank(
      caseQuery(tc),
      { variants: tc.variants, target: 'app' },
      { limit: BRIEF_LIMIT, includeQuirks: true },
    );
    briefed.push(...memories.map((m) => m.entry));
    writeFileSync(
      join(base, 'brief.md'),
      brief(frozen, tc, runId, record, { memories: memories.map((m) => m.entry), carried: carried.get(tc.id) || [] }),
    );
  }
  const secrets = [...new Set(briefed.filter((e) => e.secretRef).map((e) => e.secretRef))];
  const schedule = buildSchedule(frozen, selected, caseHistories(plan.id, runId));
  saveSchedule(runId, schedule);

  console.log(`OK run=${runId}`);
  console.log(`dir=${repoPath(dir)}`);
  console.log(`viewer=http://127.0.0.1:${PORT}/#/run/${encodeURIComponent(runId)}`);
  for (const b of schedule.batches)
    console.log(
      `batch ${b.id}: ${b.cases.join(', ')}  ${b.tier} → ${b.model}/${b.effort}  (${b.cases.map((id) => schedule.cases[id].reasons.join(', ')).join('; ')})`,
    );
  const ex = execution();
  const logins = ex.accounts.length || new Set(schedule.batches.map((b) => b.user)).size;
  const parallel = Math.min(schedule.maxParallel, schedule.batches.length, schedule.sessions === 'shared' ? Infinity : logins);
  console.log(
    `parallel: up to ${parallel} batch(es) at once (sessions ${schedule.sessions}, ${logins} login(s))${parallel === 1 && schedule.batches.length > 1 && schedule.sessions === 'exclusive' ? '; add execution.accounts in .qa/config.json to run in parallel' : ''}`,
  );
  if (briefed.length) console.log(`memory: ${new Set(briefed.map((e) => e.id)).size} pointer(s) in briefs`);
  for (const ref of secrets)
    console.log(`secret needed: ${ref} (${process.env[ref.slice(4)] ? 'set' : 'NOT set'}); pass it in the agent prompt`);
  return runId;
}

function checkPlan(plan) {
  const problems = [];
  if (!plan.id || !/^[A-Za-z0-9._-]+$/.test(plan.id))
    problems.push('id is required and may only use letters, digits, . _ -');
  if (plan.schemaVersion !== 2) problems.push('schemaVersion must be 2');
  if (!plan.title) problems.push('title is required');
  const known = Object.keys(CONFIG.variants || {});
  if (!Array.isArray(plan.testCases) || !plan.testCases.length) problems.push('testCases must be a non-empty array');
  const seen = new Set();
  for (const tc of plan.testCases || []) {
    if (!tc.id || !/^[A-Za-z0-9._-]+$/.test(tc.id)) problems.push(`test case id "${tc.id}" is invalid`);
    if (seen.has(tc.id)) problems.push(`duplicate test case id ${tc.id}`);
    seen.add(tc.id);
    if (!tc.title) problems.push(`${tc.id}: title is required`);
    if (!Array.isArray(tc.steps) || !tc.steps.length) problems.push(`${tc.id}: steps must be a non-empty array`);
    for (const step of tc.steps || [])
      if (!step.n || !step.action) problems.push(`${tc.id}: every step needs n and action`);
    if (!tc.expected) problems.push(`${tc.id}: expected is required`);
    for (const [key, value] of Object.entries(tc.variants || {})) {
      const allowed = CONFIG.variants?.[key]?.values;
      if (known.length && !known.includes(key)) problems.push(`${tc.id}: variant "${key}" is not in .qa/config.json`);
      else if (allowed && !allowed.includes(value))
        problems.push(`${tc.id}: ${key}="${value}" is not one of ${allowed.join(', ')}`);
    }
  }
  return problems;
}

// Each case's earlier outcomes in the same plan, newest first; a rejection counts as a failure.
function caseHistories(planId, exceptRunId) {
  const histories = new Map();
  for (const { id, planId: runPlan } of listRuns()) {
    if (runPlan !== planId || id === exceptRunId) continue;
    for (const tc of loadRun(id).testCases)
      histories.set(tc.id, [...(histories.get(tc.id) || []), tc.review?.verdict === 'rejected' ? 'rejected' : tc.status]);
  }
  return histories;
}

// Capabilities are project skills. Test Agents get their file path, not a Skill tool whose
// listing of every installed skill would ride along on every turn.
function capabilityPath(skill) {
  for (const dir of [join(PROJECT_ROOT, '.claude', 'skills'), join(homedir(), '.claude', 'skills')]) {
    const file = join(dir, skill, 'SKILL.md');
    if (existsSync(file)) return repoPath(file);
  }
  return null;
}

// The brief is the only input a Test Agent gets for one test case: what to do, where to write,
// and the exact shape to report back. Keeping it self-contained is what keeps agents small.
function brief(plan, tc, runId, record, { memories = [], carried = [] } = {}) {
  const base = tcDir(runId, tc.id);
  const evidence = repoPath(join(base, 'evidence'));
  const cli = `${repoPath(join(SKILL_DIR, 'scripts', 'qa-runs.mjs'))} --project "${PROJECT_ROOT.split(sep).join('/')}"`;
  const env = { ...(plan.environment || {}), ...(tc.environment || {}) };
  const targets = { ...(plan.environment?.targets || {}), ...(tc.environment?.targets || {}) };
  const referenceCheck = tc.referenceCheck || plan.defaults?.referenceCheck || 'on-deviation';
  const label = (key) => CONFIG.targets?.[key] || key;
  const variantLabel = (key) => CONFIG.variants?.[key]?.label || key;
  const lines = [
    `# Brief ${tc.id}: ${tc.title}`,
    '',
    `Run \`${runId}\` · plan \`${plan.id}\`${plan.issue ? ` · issue ${plan.issue}` : ''}`,
    '',
    '## Context',
    ...Object.entries({
      Environment: env.name,
      ...Object.fromEntries(Object.entries(targets).map(([key, url]) => [`${label(key)} URL`, url])),
      ...Object.fromEntries(Object.entries(tc.variants || {}).map(([key, value]) => [variantLabel(key), value])),
      Tool: tc.tool || plan.defaults?.tool || 'playwright-mcp',
      [`Check against ${label('reference')}`]: targets.reference ? referenceCheck : null,
    })
      .filter(([, value]) => value)
      .map(([key, value]) => `- **${key}:** ${value}`),
    ...(tc.data
      ? [
          '- **Test data:** ' +
            Object.entries(tc.data)
              .map(([k, v]) => `${k}=${v}`)
              .join(', '),
        ]
      : []),
    '- **Credentials:** given in your prompt. Never write them to a file; redact them in saved JSON as `"***"`.',
    ...((plan.references || []).length || (tc.references || []).length
      ? [
          '',
          '## Read only if you need it',
          ...[...(plan.references || []), ...(tc.references || [])].map((r) => `- ${r}`),
        ]
      : []),
    ...(Object.keys(CONFIG.capabilities || {}).length
      ? [
          '',
          '## Project procedures (read one only when a step needs it)',
          ...Object.entries(CONFIG.capabilities).map(([use, skill]) => {
            const path = capabilityPath(skill);
            return `- ${use}: ${path ? `\`${path}\`` : `skill \`${skill}\` (no SKILL.md found; use \`$Q ask\` if a step needs it)`}`;
          }),
        ]
      : []),
    ...(memories.length
      ? [
          '',
          '## Memory from earlier runs (human-confirmed; verify before relying on it)',
          ...memories.map(pointer),
        ]
      : []),
    ...(carried.length
      ? [
          '',
          '## Answers given during the previous run',
          ...carried.map((q) =>
            q.sensitive
              ? `- ${q.field}: sensitive; the orchestrator passes it in your prompt`
              : `- ${q.field}: \`${q.answer}\``,
          ),
        ]
      : []),
    ...(tc.preconditions?.length ? ['', '## Preconditions', ...tc.preconditions.map((p) => `- ${p}`)] : []),
    '',
    '## Steps',
    '| # | Action | Expected |',
    '|---|---|---|',
    ...tc.steps.map((s) => `| ${s.n} | ${cell(s.action)} | ${cell(s.expected || '')} |`),
    '',
    `**Expected result:** ${tc.expected}`,
    ...(tc.notes ? ['', `**Notes:** ${tc.notes}`] : []),
    ...(plan.guardrails?.length ? ['', '## Guardrails', ...plan.guardrails.map((g) => `- ${g}`)] : []),
    '',
    '## Paths',
    `- **$Q:** \`node ${cli}\` (run \`${runId}\`, case \`${tc.id}\`)`,
    `- **Evidence folder:** \`${evidence}/\``,
    `- **Capture snippet:** \`${repoPath(join(base, '.capture.js'))}\``,
    ...(record
      ? [
          `- **Recording:** start \`${repoPath(join(base, '.rec', 'start.js'))}\`, stop \`${repoPath(join(base, '.rec', 'stop.js'))}\` (stop prints the video file name; cite it in every step without a still)`,
        ]
      : []),
    `- **Screenshots:** ${CONFIG.evidence?.blurPersonalData ? 'blur personal data (names, IDs, phones, addresses); this project requires it.' : 'do not blur; this is test data and reviewers need to read it.'}`,
    `- **Result:** \`${repoPath(join(base, 'result.json'))}\` (contract \`${repoPath(join(SKILL_DIR, 'schemas', 'test-result.schema.json'))}\`, only if unsure). Skeleton:`,
    '',
    '```json',
    compactJson({
      schemaVersion: 2,
      testCaseId: tc.id,
      status: 'pass | fail | blocked | skipped',
      summary: '',
      environment: { versions: { app: '' }, variants: tc.variants || {} },
      steps: tc.steps.map((s) => ({ n: s.n, status: 'pass | fail | blocked | skipped | n/a', actual: '', evidence: [] })),
      evidence: [{ file: '01-<slug>.png', kind: 'screenshot', caption: '' }],
      data: {},
      defects: [],
      ...(targets.reference && {
        reference: { checked: false, result: 'same | deviation | improvement | n/a', notes: '' },
      }),
      learnings: [],
      notes: '',
    }),
    '```',
    '',
  ];
  return lines.join('\n');
}

function writeCaptureSnippet(runId, tcId) {
  writeFileSync(join(tcDir(runId, tcId), '.capture.js'), captureCode(runId, tcId));
}

// A function, not a const: commands run via top-level await before later consts initialize.
function annotateHelp() {
  return `Mark syntax for annotate --add '<json>' (one item or an array, in image pixels;
--list prints the image size, current items and the element boxes captured at test time):
  rect | ellipse | highlight {x,y,w,h,color?,label?}
  spotlight {x,y,w,h}   dims everything else
  blur {x,y,w,h}        hides personal data
  arrow {to:[x,y], from?:[x,y], color?, label?}
  text {x,y,text,color?,size?}   step {x,y,n}
Box shapes, arrow, text and step also accept "box": {x,y,width,height} (padding is added for you).
Colors: red (default), yellow, green, blue, magenta, white or #hex.
Locate elements from the captured boxes first; otherwise Read the image and estimate coordinates.
Prefer one clear arrow or box with a short label over many marks. Add --summary "<why>".`;
}

function annotate() {
  if (flags.help) return console.log(annotateHelp());
  const [runId, tcId, image] = args;
  if (!runId || !tcId || !image)
    fail("usage: annotate <runId> <tcId> <image> [--list] [--add '<json>'] [--replace] [--remove <ids|all>]");
  const evidence = join(tcDir(runId, tcId), 'evidence');
  if (!existsSync(join(evidence, image))) fail(`no image "${image}" in ${repoPath(evidence)}`);
  const author = ['agent', 'chat', 'reviewer'].includes(flags.author) ? flags.author : 'chat';
  try {
    if (flags.remove) {
      const ids = flags.remove === 'all' ? [] : String(flags.remove).split(',');
      console.log(`OK ${removeAnnotations(evidence, image, ids, author).length} annotation(s) left on ${image}`);
    } else if (flags.add) {
      let items;
      try {
        items = JSON.parse(flags.add);
      } catch (error) {
        fail(`--add is not valid JSON: ${error.message}`);
      }
      const data = writeAnnotations(evidence, image, {
        items,
        mode: flags.replace ? 'replace' : 'append',
        author,
        summary: flags.summary,
      });
      console.log(`OK ${image} now has ${data.items.length} annotation(s); the viewer shows them on its next refresh.`);
    }
  } catch (error) {
    fail(error.message);
  }
  if (flags.list || (!flags.add && !flags.remove)) {
    const data = readAnnotations(evidence, image);
    const size = imageSize(join(evidence, image));
    console.log(
      `${image}  ${size ? `${size.width}x${size.height}px` : 'size unknown'}  ${data.items.length} annotation(s)`,
    );
    for (const item of data.items) {
      const geometry =
        item.type === 'arrow'
          ? `from ${item.from} to ${item.to}`
          : `x=${item.x} y=${item.y}${item.w ? ` w=${item.w} h=${item.h}` : ''}`;
      console.log(
        `  ${item.id}  ${item.type.padEnd(9)} ${geometry}  ${item.label || item.text || ''} (${item.author})`,
      );
    }
    const elements = Object.entries(data.elements || {});
    if (elements.length) console.log('elements captured at test time:');
    for (const [name, b] of elements)
      console.log(
        `  ${name}: x=${Math.round(b.x)} y=${Math.round(b.y)} width=${Math.round(b.width)} height=${Math.round(b.height)}`,
      );
  }
}

// One key per line and each array item on its own line, values inline: the skeleton stays easy
// to fill at about a third of the size of a fully indented one.
function compactJson(value) {
  const entries = Object.entries(value).map(([key, v]) =>
    Array.isArray(v) && v.length
      ? `  "${key}": [\n${v.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`
      : `  "${key}": ${JSON.stringify(v)}`,
  );
  return `{\n${entries.join(',\n')}\n}`;
}

function cell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function writeRecordingSnippets(runId, tcId) {
  const dir = join(tcDir(runId, tcId), '.rec');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'start.js'), recordingCode(runId, tcId, 'start'));
  writeFileSync(join(dir, 'stop.js'), recordingCode(runId, tcId, 'stop'));
}

async function open() {
  if (!(await ensureServer())) fail(`viewer server did not start on port ${PORT}.`);
  const runId = args[0];
  const url = `http://127.0.0.1:${PORT}/${runId ? `#/run/${encodeURIComponent(runId)}` : ''}`;
  if (!flags['no-browser']) {
    const opener =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  console.log(`OK viewer=${url}`);
}

async function serve() {
  await import('./server.mjs');
}

function mark() {
  const [runId, tcId, state, ...note] = args;
  if (!runId || !tcId || !['running', 'pending'].includes(state))
    fail('usage: mark <runId> <tcId> <running|pending> [note]');
  const base = tcDir(runId, tcId);
  if (!existsSync(base)) fail(`unknown test case ${tcId} in run ${runId}`);
  const at = new Date().toISOString();
  writeJson(join(base, 'progress.json'), { state, note: note.join(' ') || null, at });
  const timing = join(base, 'timing.json');
  if (state === 'running' && !existsSync(timing)) writeJson(timing, { startedAt: at });
  if (state === 'pending' && existsSync(timing)) rmSync(timing);
  console.log(`OK ${tcId} ${state}`);
}

// The orchestrator's whole execute loop: print every batch that can start now, with its agent,
// model, effort and prompt, then launch exactly that. Before picking, it escalates finished
// cheap-model batches whose cases need a second look. --release <batch> puts back a batch
// whose agent died (its finished cases stay done); --fallback runs without the plugin's agents.
function next() {
  const runId = args[0];
  if (!runId || !existsSync(runDir(runId))) fail('usage: next <runId> [--release <batch>] [--fallback]');
  if (!readSchedule(runId)) fail(`run ${runId} has no schedule.json (made before 0.5.0); run init again.`);
  try {
    if (flags.release) {
      const run = loadRun(runId);
      const batch = readSchedule(runId).batches.find((b) => b.id === flags.release);
      if (!batch) fail(`unknown batch ${flags.release}`);
      const unfinished = batch.cases.filter((id) => !run.testCases.find((tc) => tc.id === id)?.result);
      for (const id of unfinished) {
        rmSync(join(tcDir(runId, id), 'progress.json'), { force: true });
        rmSync(join(tcDir(runId, id), 'timing.json'), { force: true });
      }
      finishBatch(runId, batch.id, unfinished.length ? 'pending' : 'done', unfinished);
      console.log(`RELEASED ${batch.id}: ${unfinished.length ? `${unfinished.join(', ')} will run again` : 'every case had finished'}`);
    }
    for (const b of escalate(loadRun(runId)))
      console.log(
        `ESCALATE ${b.cases.map((id) => `${id} (${b.escalatedFrom.reasons[id]})`).join(', ')} → ${b.model}/${b.effort} as batch ${b.id}; first attempt kept in tc/<id>/attempts/`,
      );
    for (;;) {
      const step = nextLaunch(runId, { fallback: Boolean(flags.fallback) });
      if (step.kind === 'done') return console.log(`DONE every batch finished. Next: $Q validate ${runId}`);
      if (step.kind === 'wait')
        return console.log(`WAIT ${step.running.map((b) => b.id).join(', ')} running${step.why ? ` (${step.why})` : ''}. Run next again when one notifies.`);
      const { batch, prompt } = step;
      const secret = batch.account?.secret;
      console.log(
        `LAUNCH ${batch.id}  subagent_type=${batch.agent}  model=${batch.model}  effort=${batch.effort}  run_in_background=true  cases=${batch.cases.join(',')}`,
      );
      if (secret?.startsWith('env:'))
        console.log(`  replace {{PASSWORD ${secret}}} with that variable's value (${process.env[secret.slice(4)] ? 'set' : 'NOT set: ask the human'})`);
      else if (prompt.includes('{{PASSWORD')) console.log('  replace {{PASSWORD …}} with the password the human gave you');
      console.log(`<<<PROMPT\n${prompt}\nPROMPT>>>`);
    }
  } catch (error) {
    fail(error.message);
  }
}

function validate() {
  const runId = args[0] || listRuns()[0]?.id;
  if (!runId || !existsSync(runDir(runId))) fail('validate needs a run id.');
  const run = loadRun(runId);
  const counts = countStatuses(run);
  const proposed = importLearnings(run);
  const memoryWarnings = scanMemories();
  writeJson(join(runDir(runId), 'run.json'), {
    id: runId,
    validatedAt: new Date().toISOString(),
    counts,
    testCases: run.testCases.map(({ id, status, warnings, review }) => ({ id, status, warnings, review })),
  });
  printStatus(run, counts, true);
  if (proposed) console.log(`memory: ${proposed} learning(s) proposed; approve them in the viewer's Memory panel.`);
  for (const w of memoryWarnings) console.log(`! ${w}`);
}

// Learnings become *proposed* memories: nothing an agent writes is reused until a human approves
// it, so one wrong conclusion cannot quietly steer every later run. Idempotent per learning.
function importLearnings(run) {
  const known = new Set(
    loadMemories({ all: true })
      .filter((e) => e.source?.run === run.id)
      .map((e) => `${e.source.tc}#${e.source.learning}`),
  );
  let added = 0;
  for (const tc of run.testCases) {
    (tc.result?.learnings || []).forEach((raw, i) => {
      const learning = typeof raw === 'string' ? { kind: 'procedure', text: raw } : raw;
      if (known.has(`${tc.id}#${i}`) || !learning?.text?.trim()) return;
      try {
        addMemory({
          kind: KINDS.includes(learning.kind) ? learning.kind : 'procedure',
          text: learning.text,
          value: learning.value || undefined,
          triggers: learning.triggers,
          status: 'proposed',
          scope: tc.variants && Object.keys(tc.variants).length ? { variants: tc.variants } : undefined,
          source: { run: run.id, tc: tc.id, learning: i, confirmedBy: null },
        });
        added += 1;
      } catch (error) {
        console.log(`! ${tc.id} learning ${i} not imported: ${error.message}`);
      }
    });
  }
  return added;
}

async function ask() {
  const [runId, tcId] = args;
  if (!runId || !tcId || !flags.field)
    fail('usage: ask <runId> <tcId> --field "<what you need>" [--context txt] [--screenshot file] [--timeout 300]');
  let question;
  try {
    question = askQuestion(runId, tcId, { field: flags.field, context: flags.context, screenshot: flags.screenshot });
  } catch (error) {
    fail(error.message);
  }
  const timeout = Math.min(Number(flags.timeout) || 300, 1800);
  console.error(`asked ${question.id}; waiting up to ${timeout}s for the human (viewer or \`answer\`)…`);
  const value = await waitForAnswer(runId, tcId, question.id, timeout);
  if (value === undefined) {
    console.log(`TIMEOUT ${question.id}: finish this case as blocked with blockedReason "needs-input".`);
    process.exit(2);
  }
  if (value === null) fail(`${question.id} was answered as sensitive, but the answer could not be read.`);
  console.log(`ANSWER ${value}`);
}

function answer() {
  const [runId, tcId, qid, ...value] = args;
  if (!runId || !tcId || !qid || !value.length)
    fail('usage: answer <runId> <tcId> <qid> <value> [--sensitive] [--remember project|user]');
  try {
    const remember = ['project', 'user'].includes(flags.remember) ? flags.remember : null;
    const q = answerQuestion(runId, tcId, qid, {
      answer: value.join(' '),
      sensitive: Boolean(flags.sensitive),
      remember,
      by: 'orchestrator',
    });
    console.log(`OK ${tcId} ${qid} answered${q.memoryId ? `; remembered as ${q.memoryId}` : ''}`);
  } catch (error) {
    fail(error.message);
  }
}

function questions() {
  const runId = args[0] || listRuns()[0]?.id;
  if (!runId) fail('no runs yet.');
  const open = openQuestions(runId);
  if (!open.length) return console.log(`${runId}: no open questions`);
  for (const q of open)
    console.log(`${q.tcId} ${q.id}  ${q.field}${q.context ? ` — ${q.context}` : ''}${q.screenshot ? ` [${q.screenshot}]` : ''}`);
}

const usd = (value) => (value === null || value === undefined ? 'n/a' : `$${value.toFixed(value < 1 ? 3 : 2)}`);

function usage() {
  const runId = args[0];
  if (!runId || !existsSync(runDir(runId))) fail('usage needs a run id.');
  const run = loadRun(runId);
  if (flags.transcript || flags.tokens) {
    const batch = flags.batch ? readSchedule(runId)?.batches.find((b) => b.id === flags.batch) : null;
    if (flags.batch && !batch) fail(`unknown batch ${flags.batch}`);
    const group = batch?.id || flags.group || null;
    const cases = batch
      ? batch.cases
      : flags.cases
      ? String(flags.cases).split(',')
      : group
        ? run.testCases.filter((tc) => (tc.group || tc.id) === group).map((tc) => tc.id)
        : [];
    if (group && !cases.length) fail(`no test case belongs to group "${group}"`);
    try {
      for (const e of recordUsage(runId, {
        group,
        cases,
        transcript: flags.transcript ? resolve(String(flags.transcript)) : null,
        tokens: flags.tokens,
        model: flags.model || batch?.model,
        effort: flags.effort || batch?.effort,
        tier: flags.tier || batch?.tier,
        toolUses: flags['tool-uses'] ? Number(flags['tool-uses']) : null,
        durationMs: flags.ms ? Number(flags.ms) : null,
      }))
        console.log(
          `OK ${group || 'run'} ${e.model} ${(e.totalTokens ?? e.reportedTokens).toLocaleString('en-US')} tokens${e.totalTokens ? '' : ' (reported)'} ${usd(e.costUsd)}${e.estimated ? ` (estimated: ${e.rateSource || 'unknown price'})` : ''} [${e.source}]${e.profile ? `  ${profileLine(e.profile)}` : ''}`,
        );
      // The same transcript holds the Playwright code the agent ran: passing cases become
      // replayable scripts in the test library.
      if (flags.transcript && existsSync(resolve(String(flags.transcript))))
        try {
          for (const line of extractScripts(loadRun(runId), cases, resolve(String(flags.transcript)), batch)) console.log(line);
        } catch (error) {
          console.log(`! scripts not saved: ${error.message}`);
        }
      if (batch) finishBatch(runId, batch.id, 'done');
    } catch (error) {
      fail(error.message);
    }
    return;
  }
  const cost = runCost(runId, run.testCases);
  if (flags.profile) return printProfile(cost.profile);
  console.log(`${runId}  total ${usd(cost.totalUsd)}${cost.estimated ? ' (partly estimated)' : ''}  agents ${usd(cost.agentsUsd)}  chat ${usd(cost.chatUsd)} (${cost.chatTurns} turns)  list prices as of ${PRICING_AS_OF}`);
  for (const e of cost.entries)
    console.log(`  ${String(e.group || '-').padEnd(10)} ${e.model.padEnd(18)} ${String(e.totalTokens ?? `${e.reportedTokens} rep.`).padStart(14)} tokens  ${usd(e.costUsd)}${e.estimated ? ' est.' : ''}`);
  if (cost.missingGroups.length) console.log(`  ! no usage recorded for group(s): ${cost.missingGroups.join(', ')}`);
}

const kTokens = (n) => (n === null || n === undefined ? 'n/a' : `${Math.round(n / 1000)}K`);
const profileLine = (p) =>
  `turns=${p.turns} context first=${kTokens(p.firstContext)} peak=${kTokens(p.peakContext)} snapshots=${p.snapshots} imageReads=${p.imageReads}`;

function printProfile(p) {
  if (!p) return console.log('no profile: record groups with --transcript');
  console.log(`${p.agents ? `agents=${p.agents} ` : ''}${profileLine(p)}`);
  const tools = Object.entries(p.tools).sort((a, b) => b[1].resultChars - a[1].resultChars);
  const total = tools.reduce((sum, [, t]) => sum + t.resultChars, 0) || 1;
  for (const [name, t] of tools)
    console.log(
      `  ${name.padEnd(28)} ${String(t.calls).padStart(5)} calls ${String(Math.round(t.resultChars / 1000)).padStart(6)}K chars ${String(Math.round((t.resultChars / total) * 100)).padStart(3)}%${t.images ? `  ${t.images} image(s)` : ''}`,
    );
}

// Where an agent's tokens went, straight from transcripts: no run needed, so it also measures
// agents from before profiles were recorded, or a baseline to compare a change against.
function profile() {
  const files = args.map((f) => resolve(f)).filter((f) => existsSync(f));
  if (!files.length) fail('usage: profile <transcript.jsonl> [more…]');
  const parsed = files.map((f) => parseTranscript(f));
  const cost = parsed.reduce(
    (sum, t) => sum + Object.entries(t.byModel).reduce((s, [model, tokens]) => s + (costOf(model, tokens) || 0), 0),
    0,
  );
  console.log(`${files.length} transcript(s)  ${usd(cost)} at list prices as of ${PRICING_AS_OF}`);
  printProfile(mergeProfiles(parsed.map((t) => t.profile)));
}

function memoryHelp() {
  return `memory list [--all]                 active memories (--all adds proposed, stale, expired)
memory show <id>                    one memory in full
memory recall "<query>" [--run R --tc T] [--limit 5]
                                    best matches, scoped to the case's variants when --run/--tc are given
memory add --text "<what it is>" [--value v | --secret-ref env:NAME] [--kind data|procedure|env-quirk|gotcha]
           [--triggers "a,b"] [--variants '{"device":"mobile"}'] [--target app] [--expires YYYY-MM-DD]
           [--share project|user] [--status proposed]
memory used <id> [--failed]         report whether a recalled memory worked (2 failures → stale)
memory approve|stale|reject <id>    curate (reject deletes)
memory prune [--yes]                delete stale and expired memories (dry run without --yes)
Secrets are never stored: use --secret-ref env:NAME and keep the value in the environment.`;
}

// The viewer's chat agent may only read memory and propose new entries; it never approves,
// retires or deletes. QA_MEMORY_ROLE is set by the chat server, not by the model.
function memory() {
  const [action, ...rest] = args;
  if (!action || flags.help) return console.log(memoryHelp());
  const asChat = process.env.QA_MEMORY_ROLE === 'chat';
  if (asChat && !['list', 'show', 'recall', 'add'].includes(action)) fail(`the chat agent cannot run memory ${action}`);
  try {
    if (action === 'list') {
      const entries = loadMemories({ all: Boolean(flags.all) });
      if (!entries.length) return console.log('no memories');
      for (const e of entries)
        console.log(`${e.id}  ${e.status.padEnd(8)} ${e.share.padEnd(7)} ${e.kind.padEnd(9)} ${e.text.split('\n')[0].slice(0, 90)}`);
    } else if (action === 'show') {
      const e = findMemory(rest[0]);
      if (!e) fail(`unknown memory ${rest[0]}`);
      const { file, ...shown } = e;
      console.log(JSON.stringify(shown, null, 2));
    } else if (action === 'recall') {
      const query = rest.join(' ');
      if (!query) fail('usage: memory recall "<query>" [--run R --tc T]');
      let context = {};
      if (flags.run && flags.tc) {
        const tc = loadRun(flags.run).testCases.find((t) => t.id === flags.tc);
        context = { variants: tc?.variants || {}, target: 'app' };
      }
      const hits = rank(query, context, { limit: Number(flags.limit) || 5 });
      if (!hits.length) return console.log('NO MATCH: ask the human with `ask` instead of guessing.');
      for (const { entry, score } of hits)
        console.log(`${pointer(entry).slice(2)}  [score ${score.toFixed(1)}, used ${entry.stats?.used || 0}, failed ${entry.stats?.failed || 0}]`);
    } else if (action === 'add') {
      let variants;
      if (flags.variants)
        try {
          variants = JSON.parse(flags.variants);
        } catch {
          fail('--variants must be JSON, e.g. \'{"device":"mobile"}\'');
        }
      const scope = { ...(variants && { variants }), ...(flags.target && { target: flags.target }) };
      const entry = addMemory(
        {
          kind: flags.kind,
          text: flags.text,
          value: flags.value === true ? undefined : flags.value,
          secretRef: flags['secret-ref'],
          triggers: flags.triggers ? String(flags.triggers).split(',') : [],
          scope,
          expires: flags.expires,
          status: asChat ? 'proposed' : flags.status,
          source: { confirmedBy: asChat ? null : 'orchestrator', via: asChat ? 'chat' : 'cli' },
        },
        flags.share === 'user' ? 'user' : 'project',
      );
      console.log(`OK ${entry.id} ${entry.status} (${entry.share})`);
    } else if (action === 'used') {
      const e = recordUse(rest[0], !flags.failed);
      console.log(`OK ${e.id} used=${e.stats.used} failed=${e.stats.failed} status=${e.status}`);
    } else if (action === 'approve') {
      const entry = findMemory(rest[0]);
      if (!entry) fail(`unknown memory ${rest[0]}`);
      updateMemory(entry.id, { status: 'active', source: { ...entry.source, confirmedBy: 'orchestrator' } });
      console.log(`OK ${entry.id} active`);
    } else if (action === 'stale') {
      console.log(`OK ${updateMemory(rest[0], { status: 'stale' }).id} stale`);
    } else if (action === 'reject') {
      console.log(`OK ${removeMemory(rest[0]).id} deleted`);
    } else if (action === 'prune') {
      const doomed = prune({ dryRun: !flags.yes });
      for (const e of doomed) console.log(`${flags.yes ? 'deleted' : 'would delete'} ${e.id} (${e.status}${e.expires ? `, expires ${e.expires}` : ''})`);
      if (!doomed.length) console.log('nothing to prune');
    } else fail(`unknown memory action "${action}"\n${memoryHelp()}`);
  } catch (error) {
    fail(error.message);
  }
}

function status() {
  const runId = args[0] || listRuns()[0]?.id;
  if (!runId) fail('no runs yet.');
  const run = loadRun(runId);
  printStatus(run, countStatuses(run), false);
}

function printStatus(run, counts, withWarnings) {
  console.log(
    `${run.id}  ${Object.entries(counts)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ')}`,
  );
  for (const tc of run.testCases) {
    const review = tc.review?.verdict ? ` review=${tc.review.verdict}` : '';
    const warn = tc.warnings.length ? ` warnings=${tc.warnings.length}` : '';
    console.log(
      `${tc.id.padEnd(16)} ${String(tc.status).padEnd(8)}${review}${warn}  ${tc.result?.summary || tc.title}`,
    );
    if (withWarnings) for (const w of tc.warnings) console.log(`    ! ${w}`);
  }
}

function latest() {
  const run = listRuns()[0];
  if (!run) fail('no runs yet.');
  console.log(run.id);
}

function testLine(t) {
  const last = t.lastReplay ? `  last replay ${t.lastReplay.status} ${t.lastReplay.at.slice(0, 10)}` : '';
  return `${t.id.padEnd(22)} ${t.status.padEnd(8)} v${t.version}  ${String(t.steps.length).padStart(2)} steps  [${(t.tags || []).join(', ')}]${last}  ${t.title}`;
}

// The test library: one replayable script per case an agent passed (see references/library.md).
function tests() {
  const [action = 'list', id, ...rest] = args;
  try {
    if (action === 'list') {
      const list = listTests().filter((t) => !flags.tag || (t.tags || []).includes(String(flags.tag).toLowerCase()));
      if (!list.length) return console.log('no tests in the library yet: they are saved when an agent passes a case.');
      for (const t of list) console.log(testLine(t));
    } else if (action === 'show') {
      const test = readTest(id);
      if (!test) fail(`unknown test ${id}`);
      console.log(JSON.stringify(test, null, 2));
    } else if (action === 'tag') {
      console.log(`OK ${id} tags: ${updateTest(id, { tags: rest.join(',') }).tags.join(', ') || '(none)'}`);
    } else if (action === 'verify' || action === 'draft') {
      console.log(`OK ${id} ${updateTest(id, { status: action === 'verify' ? 'verified' : 'draft' }).status}`);
    } else fail('usage: tests [list [--tag t] | show <id> | tag <id> <a,b> | verify <id> | draft <id>]');
  } catch (error) {
    fail(error.message);
  }
}

const testsByTag = (tag) =>
  listTests()
    .filter((t) => (t.tags || []).includes(String(tag).toLowerCase()))
    .map((t) => t.id);

// Suites are the viewer's "Test plans": a name, free tags and a list of library tests.
async function suite() {
  const [action = 'list', id, ...rest] = args;
  try {
    if (action === 'list') {
      const suites = listSuites();
      if (!suites.length) return console.log('no test plans yet: create one with `suite create "<name>"` or in the viewer.');
      for (const s of suites) console.log(`${s.id.padEnd(24)} ${String(s.tests.length).padStart(3)} tests  [${s.tags.join(', ')}]  ${s.name}`);
    } else if (action === 'show') {
      const s = readSuite(id);
      if (!s) fail(`unknown test plan ${id}`);
      console.log(`${s.name}  (${s.id})  tags: ${s.tags.join(', ') || '-'}`);
      for (const testId of s.tests) {
        const t = readTest(testId);
        console.log(t ? `  ${testLine(t)}` : `  ${testId}  (missing from the library)`);
      }
    } else if (action === 'create') {
      const name = [id, ...rest].filter(Boolean).join(' ');
      const ids = [...(flags.tests ? String(flags.tests).split(',') : []), ...(flags.tag ? testsByTag(flags.tag) : [])];
      for (const testId of ids) if (!readTest(testId)) fail(`unknown test ${testId}`);
      const s = saveSuite({ name, tags: flags.tags === true ? [] : cleanTags(flags.tags || ''), tests: ids }, { create: true });
      console.log(`OK ${s.id} "${s.name}" ${s.tests.length} test(s)`);
    } else if (action === 'add' || action === 'remove') {
      const s = readSuite(id);
      if (!s) fail(`unknown test plan ${id}`);
      const ids = [...rest, ...(flags.tag ? testsByTag(flags.tag) : [])];
      for (const testId of ids) if (action === 'add' && !readTest(testId)) fail(`unknown test ${testId}`);
      const tests = action === 'add' ? [...s.tests, ...ids] : s.tests.filter((t) => !ids.includes(t));
      console.log(`OK ${id} ${saveSuite({ ...s, tests }).tests.length} test(s)`);
    } else if (action === 'delete') {
      deleteSuite(id);
      console.log(`OK ${id} deleted`);
    } else if (action === 'run') {
      if (!(await ensureServer())) fail(`viewer server did not start on port ${PORT}; captures and recordings need it.`);
      const { runId, warnings } = prepareSuiteRun(id, { label: flags.label });
      console.log(`OK run=${runId}`);
      console.log(`viewer=http://127.0.0.1:${PORT}/#/run/${encodeURIComponent(runId)}`);
      for (const w of warnings) console.log(`! ${w}`);
      await executeRun(runId, { headed: Boolean(flags.headed), log: (line) => console.log(line) });
      const run = loadRun(runId);
      printStatus(run, countStatuses(run), true);
    } else
      fail(
        'usage: suite [list | show <id> | create <name> [--tags a,b] [--tests ids] [--tag t] | add|remove <id> <testIds…> [--tag t] | delete <id> | run <id> [--headed] [--label txt]]',
      );
  } catch (error) {
    fail(error.message);
  }
}

// Runs a run folder prepared by the viewer's "Run" button (the server spawns this detached).
async function replay() {
  const runId = args[0];
  if (!runId || !existsSync(runDir(runId))) fail('usage: replay <runId>');
  await ensureServer();
  await executeRun(runId, { headed: Boolean(flags.headed), log: (line) => console.log(line) });
}

// A replay that failed because the UI changed on purpose is repaired by a Test Agent: a new run of
// just that case, briefed from the original steps. When the agent passes it, `usage --batch`
// saves its script as the next version of the same library test.
async function heal() {
  const [runId, tcId] = args;
  if (!runId || !tcId || !existsSync(runDir(runId))) fail('usage: heal <runId> <tcId>');
  const run = loadRun(runId);
  const tc = run.testCases.find((t) => t.id === tcId);
  if (!tc) fail(`unknown test case ${tcId} in ${runId}`);
  const name = tc.source ? `${tc.source.planId}/${tc.source.tcId}` : tcId;
  // The agent is told why it is here: the brief's notes carry the replay failure.
  const why = tc.result?.notes?.split('\n')[0] || tc.result?.summary || 'the recorded script no longer replays';
  const plan = {
    ...run.plan,
    testCases: run.plan.testCases.map((t) =>
      t.id === tcId
        ? { ...t, notes: [t.notes, `Repairing a recorded script. ${why} The UI may have changed on purpose: follow the steps as the app works now, and pass only if the expected result holds.`].filter(Boolean).join('\n') }
        : t,
    ),
  };
  const planFile = join(runDir(runId), `heal-${tcId}.plan.json`);
  writeJson(planFile, plan);
  const healId = await init(planFile, { only: tcId, label: `Repair ${name}`, heal: runId, record: tc.record });
  console.log(`NEXT in Claude Code: "run-test-plan: execute run ${healId}, already initialized (references/execute.md, from \`next\`)"`);
}

// Dispatch last, so every function and constant above is initialized before a command runs.
const commands = { init: () => init(), open, serve, mark, next, validate, status, latest, annotate, ask, answer, questions, memory, usage, profile, tests, suite, replay, heal };
if (!commands[command]) {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n')
      .slice(1)
      .filter((line, i, lines) => lines.slice(0, i + 1).every((l) => l.startsWith('//')))
      .join('\n')
      .replace(/^\/\/ ?/gm, ''),
  );
  process.exit(command ? 1 : 0);
}
await commands[command]();
